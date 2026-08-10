import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, groceryListItemsTable, mealPlanEntriesTable, recipesTable, type GroceryListItemRecipeSource } from "@workspace/db";
import type { Ingredient, IngredientCategory } from "@workspace/api-zod";

interface RecipeIngredients {
  recipeId: number;
  recipeTitle: string;
  ingredients: Ingredient[];
}

interface AggregatedItem {
  name: string;
  unit: string | null;
  quantity: number | null;
  category: IngredientCategory;
  recipeSources: GroceryListItemRecipeSource[];
}

/** Aggregates ingredients across a week's meal plan, summing quantities when name+unit match exactly (case-insensitive on name), and tracking which recipes each item came from. */
function aggregateIngredients(recipeIngredientLists: RecipeIngredients[]): AggregatedItem[] {
  const byKey = new Map<string, AggregatedItem>();

  for (const { recipeId, recipeTitle, ingredients } of recipeIngredientLists) {
    for (const ingredient of ingredients) {
      const unit = ingredient.unit ?? null;
      const key = `${ingredient.name.trim().toLowerCase()}::${(unit ?? "").trim().toLowerCase()}`;
      const existing = byKey.get(key);
      if (existing) {
        if (existing.quantity != null && ingredient.quantity != null) {
          existing.quantity += ingredient.quantity;
        } else {
          existing.quantity = null;
        }
        if (!existing.recipeSources.some((r) => r.id === recipeId)) {
          existing.recipeSources.push({ id: recipeId, title: recipeTitle });
        }
      } else {
        byKey.set(key, {
          name: ingredient.name.trim(),
          unit,
          quantity: ingredient.quantity ?? null,
          category: ingredient.category,
          recipeSources: [{ id: recipeId, title: recipeTitle }],
        });
      }
    }
  }

  return Array.from(byKey.values());
}

/**
 * Regenerates the "auto" grocery list items for a week from that week's meal plan.
 * Preserves `checked` state on items whose name+unit still match, removes stale auto
 * items no longer needed, and leaves manually added items untouched.
 */
export async function regenerateGroceryListForWeek(weekStart: string): Promise<void> {
  const weekStartDate = new Date(`${weekStart}T00:00:00Z`);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  const weekEnd = weekEndDate.toISOString().slice(0, 10);

  const entries = await db
    .select({ recipeId: recipesTable.id, recipeTitle: recipesTable.title, ingredients: recipesTable.ingredients })
    .from(mealPlanEntriesTable)
    .innerJoin(recipesTable, eq(mealPlanEntriesTable.recipeId, recipesTable.id))
    .where(and(gte(mealPlanEntriesTable.date, weekStart), lte(mealPlanEntriesTable.date, weekEnd)));

  const aggregated = aggregateIngredients(entries);

  const existingAutoItems = await db
    .select()
    .from(groceryListItemsTable)
    .where(and(eq(groceryListItemsTable.weekStart, weekStart), eq(groceryListItemsTable.source, "auto")));

  const existingByKey = new Map(
    existingAutoItems.map((item) => [`${item.name.trim().toLowerCase()}::${(item.unit ?? "").trim().toLowerCase()}`, item]),
  );

  const keptIds = new Set<number>();

  for (const item of aggregated) {
    const key = `${item.name.toLowerCase()}::${(item.unit ?? "").trim().toLowerCase()}`;
    const existing = existingByKey.get(key);
    if (existing) {
      keptIds.add(existing.id);
      await db
        .update(groceryListItemsTable)
        .set({ quantity: item.quantity, category: item.category, recipeSources: item.recipeSources })
        .where(eq(groceryListItemsTable.id, existing.id));
    } else {
      await db.insert(groceryListItemsTable).values({
        weekStart,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        checked: false,
        source: "auto",
        recipeSources: item.recipeSources,
      });
    }
  }

  const staleIds = existingAutoItems.map((item) => item.id).filter((id) => !keptIds.has(id));
  if (staleIds.length > 0) {
    await db.delete(groceryListItemsTable).where(inArray(groceryListItemsTable.id, staleIds));
  }
}
