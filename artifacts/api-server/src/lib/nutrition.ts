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
