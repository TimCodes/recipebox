import { openai } from "@workspace/integrations-openai-ai-server";
import type { IngestedRecipe, RecipeSummary, MealSlot } from "@workspace/api-zod";
import type { Recipe } from "@workspace/db";
import { toRecipeSummary } from "./recipe-summary";
import { RECIPE_OBJECT_SCHEMA } from "./recipe-ingestion";

export class RecipeGenerationError extends Error {}

function summarizeRecipeForContext(r: Recipe): string {
  const ingredientList = r.ingredients.map((i) => i.name).join(", ") || "none listed";
  return `- id:${r.id} | "${r.title}" | tags: ${r.tags.join(", ") || "none"} | servings: ${r.servings ?? "?"} | ingredients: ${ingredientList}`;
}

interface GenerateRecipeResult {
  recipe: IngestedRecipe;
  inspiredBy: RecipeSummary[];
}

const GENERATE_RECIPE_SCHEMA = {
  type: "object",
  properties: {
    recipe: RECIPE_OBJECT_SCHEMA,
    inspiredByIds: {
      type: "array",
      items: { type: "integer" },
      description:
        "ids (from the provided candidate list) of existing recipes that most directly informed this new recipe. Empty array if none were used or no candidates were given.",
    },
  },
  required: ["recipe", "inspiredByIds"],
  additionalProperties: false,
} as const;

/** Generates a single new recipe grounded in the user's request and (when available) similar recipes from their own collection. */
export async function generateRecipeFromPrompt(prompt: string, candidates: Recipe[]): Promise<GenerateRecipeResult> {
  const candidateBlock =
    candidates.length > 0
      ? `Here are some recipes already in the user's collection that may be relevant:\n${candidates.map(summarizeRecipeForContext).join("\n")}`
      : "The user's recipe collection is currently empty or has nothing relevant — invent a reasonable recipe from scratch.";

  const completion = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You are a recipe assistant grounded in the user's own recipe collection. Given the user's request and a list " +
          "of candidate recipes from their collection, generate ONE new recipe that satisfies their request. Prefer " +
          "flavors, techniques, and ingredients consistent with the candidates when they're relevant to the request, but " +
          "invent something new if nothing in the collection fits. Fill in ingredients (name, quantity as a number when " +
          "sensible, unit, best-guess category), full step-by-step instructions, servings, prep/cook time in minutes, " +
          "and relevant tags. Use null for anything that can't reasonably be determined. Report which candidate ids (if " +
          "any) most directly influenced the result in inspiredByIds; use [] if none did.",
      },
      { role: "user", content: `${candidateBlock}\n\nUser's request: ${prompt}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "recipe_generation", strict: true, schema: GENERATE_RECIPE_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new RecipeGenerationError("The recipe generation service returned an empty response.");
  }

  let parsed: { recipe: IngestedRecipe; inspiredByIds: number[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RecipeGenerationError("The recipe generation service returned a malformed response.");
  }

  if (!parsed.recipe?.title?.trim() || !parsed.recipe?.instructions?.trim()) {
    throw new RecipeGenerationError("Couldn't generate a usable recipe from that request. Try rephrasing it.");
  }

  const candidateIds = new Set(candidates.map((c) => c.id));
  const inspiredBy = candidates
    .filter((c) => candidateIds.has(c.id) && (parsed.inspiredByIds ?? []).includes(c.id))
    .map(toRecipeSummary);

  return { recipe: parsed.recipe, inspiredBy };
}

export interface MealPlanSlotRequest {
  date: string;
  mealSlot: MealSlot;
}

export interface GeneratedMealPlanAssignment {
  date: string;
  mealSlot: MealSlot;
  existingRecipe: RecipeSummary | null;
  newRecipe: IngestedRecipe | null;
  newRecipeKey: string | null;
  note: string | null;
}

export interface SkippedMealPlanSlot {
  date: string;
  mealSlot: MealSlot;
  reason: string;
}

interface GenerateMealPlanResult {
  assignments: GeneratedMealPlanAssignment[];
  skippedSlots: SkippedMealPlanSlot[];
  notes: string | null;
}

const MEAL_PLAN_SCHEMA = {
  type: "object",
  properties: {
    assignments: {
      type: "array",
      description: "One entry per requested (date, mealSlot) slot the plan fills. Omit slots you can't confidently fill.",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD, must match one of the requested slot dates exactly." },
          mealSlot: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
          existingRecipeId: {
            type: ["integer", "null"],
            description: "id of an existing recipe (from the provided list) to reuse for this slot, or null if proposing a new recipe instead.",
          },
          newRecipe: {
            anyOf: [RECIPE_OBJECT_SCHEMA, { type: "null" }],
            description: "A new recipe to propose for this slot, or null if reusing an existing recipe via existingRecipeId.",
          },
          newRecipeKey: {
            type: ["string", "null"],
            description:
              "When the SAME new recipe is used for more than one slot (e.g. a big-batch dinner made once and eaten twice), give every slot using it the same key so it's only created once. Null for one-off new recipes or existing-recipe slots.",
          },
          note: { type: ["string", "null"], description: "Optional short note, e.g. 'big-batch, extra for leftovers'." },
        },
        required: ["date", "mealSlot", "existingRecipeId", "newRecipe", "newRecipeKey", "note"],
        additionalProperties: false,
      },
    },
    planNotes: { type: ["string", "null"], description: "Optional short overall note about the plan as a whole." },
  },
  required: ["assignments", "planNotes"],
  additionalProperties: false,
} as const;

/** Proposes recipe assignments for the requested (date, mealSlot) combinations, drawing on the user's existing recipes and generating new ones to fill gaps. */
export async function generateMealPlanFromPrompt(params: {
  prompt: string;
  slotsToFill: MealPlanSlotRequest[];
  contextRecipes: Recipe[];
  allRecipes: Pick<Recipe, "id" | "title" | "tags">[];
}): Promise<GenerateMealPlanResult> {
  const { prompt, slotsToFill, contextRecipes, allRecipes } = params;

  const slotList = slotsToFill.map((s) => `${s.date} (${s.mealSlot})`).join(", ");
  const fullCollectionBlock =
    allRecipes.length > 0
      ? `Full list of existing recipes you may reuse by id (id | title | tags):\n${allRecipes
          .map((r) => `- id:${r.id} | "${r.title}" | ${r.tags.join(", ") || "no tags"}`)
          .join("\n")}`
      : "The user has no existing recipes yet — you'll need to propose new recipes for every slot.";
  const detailedBlock =
    contextRecipes.length > 0
      ? `\n\nDetailed context on recipes that seem most relevant to this request:\n${contextRecipes.map(summarizeRecipeForContext).join("\n")}`
      : "";

  const completion = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You are a meal-planning assistant grounded in the user's own recipe collection. You must fill each requested " +
          "(date, mealSlot) slot with EITHER an existing recipe (by id, from the provided full list) OR a brand-new " +
          "recipe you generate, based on the user's request. Prefer reusing existing recipes the user already has when " +
          "they fit; propose new recipes to fill gaps or add variety as requested. If the user asks for a big-batch " +
          "recipe reused across multiple slots, generate it once and reference it in every slot with the SAME " +
          "newRecipeKey. Only include a slot in assignments if you can confidently fill it; leave slots you're unsure " +
          "about out entirely rather than guessing badly.",
      },
      {
        role: "user",
        content: `Requested slots to fill: ${slotList}\n\n${fullCollectionBlock}${detailedBlock}\n\nUser's request: ${prompt}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "meal_plan_generation", strict: true, schema: MEAL_PLAN_SCHEMA },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new RecipeGenerationError("The meal plan generation service returned an empty response.");
  }

  interface RawAssignment {
    date: string;
    mealSlot: MealSlot;
    existingRecipeId: number | null;
    newRecipe: IngestedRecipe | null;
    newRecipeKey: string | null;
    note: string | null;
  }
  let parsed: { assignments: RawAssignment[]; planNotes: string | null };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RecipeGenerationError("The meal plan generation service returned a malformed response.");
  }

  const requestedKeys = new Set(slotsToFill.map((s) => `${s.date}|${s.mealSlot}`));
  const recipeById = new Map(allRecipes.map((r) => [r.id, r]));
  const fullRecipeById = new Map(contextRecipes.map((r) => [r.id, r]));

  const assignments: GeneratedMealPlanAssignment[] = [];
  const filledKeys = new Set<string>();
  const skippedSlots: SkippedMealPlanSlot[] = [];

  for (const raw of parsed.assignments ?? []) {
    const key = `${raw.date}|${raw.mealSlot}`;
    if (!requestedKeys.has(key)) continue; // ignore anything outside what was asked for
    if (filledKeys.has(key)) continue; // ignore duplicate proposals for the same slot

    const hasExisting = raw.existingRecipeId != null;
    const hasNew = raw.newRecipe != null && raw.newRecipe.title?.trim() && raw.newRecipe.instructions?.trim();

    if (hasExisting && !recipeById.has(raw.existingRecipeId as number)) {
      skippedSlots.push({ date: raw.date, mealSlot: raw.mealSlot, reason: "The AI referenced a recipe that doesn't exist." });
      continue;
    }
    if (!hasExisting && !hasNew) {
      skippedSlots.push({ date: raw.date, mealSlot: raw.mealSlot, reason: "The AI didn't produce a usable recipe for this slot." });
      continue;
    }

    const existingSummary = hasExisting
      ? (() => {
          const full = fullRecipeById.get(raw.existingRecipeId as number);
          return full ? toRecipeSummary(full) : recipeLiteToSummary(recipeById.get(raw.existingRecipeId as number)!);
        })()
      : null;

    assignments.push({
      date: raw.date,
      mealSlot: raw.mealSlot,
      existingRecipe: existingSummary,
      newRecipe: hasExisting ? null : raw.newRecipe,
      newRecipeKey: hasExisting ? null : (raw.newRecipeKey ?? null),
      note: raw.note ?? null,
    });
    filledKeys.add(key);
  }

  for (const slot of slotsToFill) {
    const key = `${slot.date}|${slot.mealSlot}`;
    if (!filledKeys.has(key) && !skippedSlots.some((s) => s.date === slot.date && s.mealSlot === slot.mealSlot)) {
      skippedSlots.push({ date: slot.date, mealSlot: slot.mealSlot, reason: "The AI didn't propose anything for this slot." });
    }
  }

  if (assignments.length === 0) {
    throw new RecipeGenerationError("Couldn't generate a usable meal plan from that request. Try rephrasing it.");
  }

  return { assignments, skippedSlots, notes: parsed.planNotes ?? null };
}

function recipeLiteToSummary(r: Pick<Recipe, "id" | "title" | "tags">): RecipeSummary {
  return { id: r.id, title: r.title, tags: r.tags, photoUrl: null, servings: null, prepMinutes: null, cookMinutes: null };
}
