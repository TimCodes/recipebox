import { getOpenAI, modelFor } from "@workspace/openai";
import type { Recipe as RecipeRow } from "@workspace/db";
import type { NutritionIngredientBreakdown, NutritionInput } from "@workspace/api-zod";

/**
 * Estimates per-serving nutrition from a recipe's ingredients, for recipes whose source never
 * printed a panel.
 *
 * The division of labour is the whole design: the model supplies a **gram weight** and a
 * **per-100g composition** for each ingredient — language and world knowledge, which it is good
 * at — and every arithmetic step happens here. Models are unreliable at multi-step arithmetic,
 * and a wrong total is indistinguishable from a right one, so summing eight ingredients and
 * dividing by servings is not work to delegate.
 *
 * It also sets up the USDA phase cleanly: swapping where the per-100g figures come from
 * changes nothing about this file's arithmetic, the stored shape, or the API.
 */

export class NutritionEstimateError extends Error {}

/** Per-100g composition plus the assumed weight, which is all we need from the model. */
const ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    ingredients: {
      type: "array",
      description: "One entry per ingredient given, in the same order.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The ingredient, as you understood it." },
          grams: {
            type: ["number", "null"],
            description:
              "Total weight in grams for the quantity stated. Convert volumes using the density of THIS food (a cup of flour is ~120g, a cup of oil ~216g), and counts using typical item weights (a clove of garlic ~3g). Null only if the quantity is genuinely indeterminate, e.g. 'salt to taste'.",
          },
          caloriesPer100g: { type: ["number", "null"] },
          proteinPer100g: { type: ["number", "null"] },
          carbsPer100g: { type: ["number", "null"] },
          fatPer100g: { type: ["number", "null"] },
          note: {
            type: ["string", "null"],
            description: "Short caveat if an assumption was needed, e.g. 'drained weight'.",
          },
        },
        required: [
          "name",
          "grams",
          "caloriesPer100g",
          "proteinPer100g",
          "carbsPer100g",
          "fatPer100g",
          "note",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["ingredients"],
  additionalProperties: false,
} as const;

interface RawIngredientEstimate {
  name: string;
  grams: number | null;
  caloriesPer100g: number | null;
  proteinPer100g: number | null;
  carbsPer100g: number | null;
  fatPer100g: number | null;
  note: string | null;
}

/** Rounds to one decimal; whole numbers for calories. */
const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface EstimateResult {
  nutrition: NutritionInput;
  breakdown: NutritionIngredientBreakdown[];
}

export async function estimateNutrition(recipe: RecipeRow): Promise<EstimateResult> {
  if (!recipe.servings || recipe.servings < 1) {
    throw new NutritionEstimateError(
      "This recipe has no servings set, so per-serving values cannot be worked out. Add servings first.",
    );
  }
  if (recipe.ingredients.length === 0) {
    throw new NutritionEstimateError("This recipe has no ingredients to estimate from.");
  }

  const ingredientList = recipe.ingredients
    .map((i) => `- ${i.quantity ?? "?"} ${i.unit ?? ""} ${i.name}`.replace(/\s+/g, " ").trim())
    .join("\n");

  const completion = await getOpenAI().chat.completions.create({
    model: modelFor("recipe"),
    max_completion_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          "You convert recipe ingredients into weights and standard nutrition figures. For each ingredient give " +
          "the weight in grams that is actually EATEN for the quantity stated, and the composition per 100g of " +
          "that food. Do NOT total anything, do not divide by servings, and do not return per-serving values — " +
          "only per-ingredient weights and per-100g figures. Use widely accepted reference values (as published " +
          "by food composition databases) rather than guessing. If a quantity cannot be determined, set grams to " +
          "null and still give the per-100g composition. " +
          "Weight eaten is not always weight bought. Frying oil is the big one: a pan or pot of oil for frying " +
          "is mostly left behind, so count only what the food absorbs — roughly 10% of the weight of what is " +
          "fried, never the full amount poured in. The same applies to a marinade or brine that is drained off " +
          "before cooking, and to water used for boiling. Say what you assumed in the note.",
      },
      {
        role: "user",
        content: `Recipe: ${recipe.title}\nServes: ${recipe.servings}\n\nIngredients:\n${ingredientList}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "nutrition_estimate", strict: true, schema: ESTIMATE_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new NutritionEstimateError("The estimation service returned an empty response.");

  let parsed: { ingredients: RawIngredientEstimate[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new NutritionEstimateError("The estimation service returned a malformed response.");
  }

  const rows = parsed.ingredients ?? [];
  if (rows.length === 0) throw new NutritionEstimateError("No ingredients could be estimated.");

  // All arithmetic below happens here, never in the model.
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  const breakdown: NutritionIngredientBreakdown[] = [];

  for (const row of rows) {
    const factor = row.grams != null ? row.grams / 100 : 0;
    const calories = row.caloriesPer100g != null ? row.caloriesPer100g * factor : null;
    const protein = row.proteinPer100g != null ? row.proteinPer100g * factor : null;
    const carbs = row.carbsPer100g != null ? row.carbsPer100g * factor : null;
    const fat = row.fatPer100g != null ? row.fatPer100g * factor : null;

    totalCalories += calories ?? 0;
    totalProtein += protein ?? 0;
    totalCarbs += carbs ?? 0;
    totalFat += fat ?? 0;

    breakdown.push({
      name: row.name,
      grams: row.grams == null ? null : round1(row.grams),
      calories: calories == null ? null : round1(calories),
      proteinG: protein == null ? null : round1(protein),
      carbsG: carbs == null ? null : round1(carbs),
      fatG: fat == null ? null : round1(fat),
      note: row.note,
    });
  }

  const servings = recipe.servings;
  const perServing = {
    calories: Math.round(totalCalories / servings),
    proteinG: round1(totalProtein / servings),
    carbsG: round1(totalCarbs / servings),
    fatG: round1(totalFat / servings),
  };

  assertPlausible(perServing);

  return {
    nutrition: { ...perServing, source: "estimated" },
    breakdown,
  };
}

/**
 * Rejects results that cannot be right, rather than storing a confident-looking wrong number.
 *
 * The Atwater check is the useful one: calories should be close to 4·protein + 4·carbs +
 * 9·fat by definition, so a large disagreement means the macros and the calorie figure did not
 * come from the same place. The tolerance is loose because fiber, alcohol and rounding all
 * move it legitimately.
 */
function assertPlausible(v: {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}): void {
  if (!Number.isFinite(v.calories) || v.calories <= 0) {
    throw new NutritionEstimateError("The estimate produced no usable calorie figure.");
  }
  if (v.calories > 5000) {
    throw new NutritionEstimateError(
      `The estimate came out at ${v.calories} calories per serving, which is implausible. Check the ingredient quantities and servings.`,
    );
  }
  if (v.proteinG < 0 || v.carbsG < 0 || v.fatG < 0) {
    throw new NutritionEstimateError("The estimate produced negative macros.");
  }

  const fromMacros = 4 * v.proteinG + 4 * v.carbsG + 9 * v.fatG;
  if (fromMacros > 0) {
    const drift = Math.abs(v.calories - fromMacros) / Math.max(v.calories, fromMacros);
    if (drift > 0.35) {
      throw new NutritionEstimateError(
        `The estimate is internally inconsistent — ${v.calories} calories against ${Math.round(fromMacros)} implied by its own macros. Not storing it.`,
      );
    }
  }
}
