import { createHash } from "node:crypto";
import type { Recipe as RecipeRow } from "@workspace/db";
import type { Ingredient, Nutrition, NutritionInput } from "@workspace/api-zod";

/**
 * Per-serving nutrition storage helpers.
 *
 * Phase 1 only captures what a source already states — a cookbook's "PER SERVING" panel.
 * Nothing here estimates. That distinction is deliberate: once a number is stored, a guess and
 * a publisher's tested value are indistinguishable unless provenance is recorded alongside it,
 * so `source` is required rather than optional.
 */

/**
 * Fingerprints the recipe facts the numbers describe.
 *
 * Staleness is derived by comparing this on read rather than kept as a stored boolean. A flag
 * has to be cleared by every write path — recipe update, future estimation, manual edit — and
 * the one path that forgets leaves a number that looks current and isn't.
 *
 * Servings is included because per-serving values depend on it directly: halving the servings
 * on a recipe invalidates its panel even though no ingredient changed.
 */
export function nutritionInputHash(
  ingredients: Ingredient[],
  servings: number | null,
): string {
  const normalized = ingredients.map((i) => ({
    name: i.name.trim().toLowerCase(),
    quantity: i.quantity ?? null,
    unit: (i.unit ?? "").trim().toLowerCase() || null,
  }));
  return createHash("sha256")
    .update(JSON.stringify({ ingredients: normalized, servings: servings ?? null }))
    .digest("hex");
}

/** Maps the stored columns onto the API shape, or null when the recipe has no nutrition. */
export function toNutrition(recipe: RecipeRow): Nutrition | null {
  if (!recipe.nutritionSource) return null;

  return {
    calories: recipe.calories,
    proteinG: recipe.proteinG,
    carbsG: recipe.carbsG,
    fatG: recipe.fatG,
    source: recipe.nutritionSource,
    extras: (recipe.nutritionExtras ?? undefined) as Nutrition["extras"],
    // A missing hash (nothing has ever been recorded against these inputs) is not stale — only
    // a hash that disagrees with the current recipe is.
    stale:
      recipe.nutritionInputHash !== null &&
      recipe.nutritionInputHash !== nutritionInputHash(recipe.ingredients, recipe.servings),
    updatedAt: recipe.nutritionUpdatedAt,
  };
}

export interface NutritionColumns {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  nutritionSource: "stated" | "estimated" | "computed" | "manual" | null;
  nutritionExtras: Record<string, unknown> | null;
  nutritionInputHash: string | null;
  nutritionUpdatedAt: Date | null;
}

/** Turns an incoming nutrition payload into column values, hashed against the recipe it describes. */
export function toNutritionColumns(
  nutrition: NutritionInput | null | undefined,
  ingredients: Ingredient[],
  servings: number | null,
): NutritionColumns {
  if (!nutrition) {
    return {
      calories: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      nutritionSource: null,
      nutritionExtras: null,
      nutritionInputHash: null,
      nutritionUpdatedAt: null,
    };
  }

  return {
    calories: nutrition.calories ?? null,
    proteinG: nutrition.proteinG ?? null,
    carbsG: nutrition.carbsG ?? null,
    fatG: nutrition.fatG ?? null,
    nutritionSource: nutrition.source,
    nutritionExtras: (nutrition.extras ?? null) as Record<string, unknown> | null,
    nutritionInputHash: nutritionInputHash(ingredients, servings),
    nutritionUpdatedAt: new Date(),
  };
}

/**
 * True when a payload carries no usable numbers. The extraction model returns an object of
 * nulls for recipes whose source printed no panel, and storing that would claim we have
 * nutrition data when we have none.
 */
export function isEmptyNutrition(nutrition: NutritionInput | null | undefined): boolean {
  if (!nutrition) return true;
  return (
    nutrition.calories == null &&
    nutrition.proteinG == null &&
    nutrition.carbsG == null &&
    nutrition.fatG == null
  );
}

/**
 * Parses a printed per-serving nutrition panel out of recipe text.
 *
 * Cookbooks print these in a highly regular form:
 *
 *   PER SERVING: Calories: 189; Protein: 7g; Total Carbohydrates: 14g;
 *   Sugars: 2g; Fiber: 4g; Total Fat: 13g; Saturated Fat: 2g; Cholesterol: 1mg; Sodium: 313mg
 *
 * Regular enough that this needs no model call — which matters, because backfilling a whole
 * cookbook through the AI would cost money and minutes to recover numbers that are sitting
 * in the text verbatim. Deterministic parsing is also exactly reproducible, which an
 * extraction call is not.
 *
 * Returns undefined unless at least one macro was found, so a page without a panel yields
 * nothing rather than an all-null record.
 */
export function parseNutritionPanel(text: string): NutritionInput | undefined {
  // Everything after the marker, capped so we don't run into the next recipe on a shared page.
  const marker = /per\s+serving\s*:?/i.exec(text);
  if (!marker) return undefined;
  const panel = text.slice(marker.index, marker.index + 400);

  const num = (label: RegExp): number | null => {
    // Thousands separators are real here — "Calories: 1,235" appears in this cookbook — and a
    // digits-only capture silently truncates it to 1, which reads as a plausible-ish number
    // rather than an obvious parse failure. Capture the commas, then strip them.
    // The label must be wrapped: several of these contain top-level alternation, and
    // concatenating the value pattern would otherwise bind it to the last alternative only,
    // so "Total Fat" would match with no captured number and read as absent.
    const m = new RegExp(`(?:${label.source})` + String.raw`\s*:?\s*([\d,]*\d(?:\.\d+)?)`, "i").exec(panel);
    if (!m) return null;
    const value = Number(m[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  };

  // "Saturated Fat" must be excluded from the "Total Fat" match, hence the explicit
  // alternation anchored on "total" rather than a bare /fat/.
  const calories = num(/calories/);
  const proteinG = num(/protein/);
  const carbsG = num(/(?:total\s+)?carbohydrates?|carbs/);
  const fatG = num(/total\s+fat|(?<!saturated\s)fat/);

  if (calories == null && proteinG == null && carbsG == null && fatG == null) return undefined;

  const extras: Record<string, number> = {};
  const fiberG = num(/(?:dietary\s+)?fib(?:er|re)/);
  const sugarG = num(/sugars?/);
  const saturatedFatG = num(/saturated\s+fat/);
  const cholesterolMg = num(/cholesterol/);
  const sodiumMg = num(/sodium/);
  if (fiberG != null) extras["fiberG"] = fiberG;
  if (sugarG != null) extras["sugarG"] = sugarG;
  if (saturatedFatG != null) extras["saturatedFatG"] = saturatedFatG;
  if (cholesterolMg != null) extras["cholesterolMg"] = cholesterolMg;
  if (sodiumMg != null) extras["sodiumMg"] = sodiumMg;

  return {
    calories: calories == null ? null : Math.round(calories),
    proteinG,
    carbsG,
    fatG,
    source: "stated",
    ...(Object.keys(extras).length > 0 ? { extras } : {}),
  };
}
