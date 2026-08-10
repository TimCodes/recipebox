import type { Recipe as RecipeRow } from "@workspace/db";
import type { RecipeSummary } from "@workspace/api-zod";

export function toRecipeSummary(recipe: RecipeRow): RecipeSummary {
  return {
    id: recipe.id,
    title: recipe.title,
    photoUrl: recipe.photoUrl,
    servings: recipe.servings,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    tags: recipe.tags,
  };
}
