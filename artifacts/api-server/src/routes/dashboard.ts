import { Router, type IRouter } from "express";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { db, groceryListItemsTable, mealPlanEntriesTable, recipesTable } from "@workspace/db";
import { GetDashboardSummaryQueryParams, GetDashboardSummaryResponse } from "@workspace/api-zod";
import { toDateString } from "../lib/date";
import { toRecipeSummary } from "../lib/recipe-summary";

const router: IRouter = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const query = GetDashboardSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const weekStart = toDateString(query.data.weekStart);
  const weekEndDate = new Date(`${weekStart}T00:00:00Z`);
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
  const weekEnd = toDateString(weekEndDate);
  const today = toDateString(new Date());

  const allRecipes = await db.select().from(recipesTable).orderBy(desc(recipesTable.createdAt));

  const weekEntryRows = await db
    .select()
    .from(mealPlanEntriesTable)
    .innerJoin(recipesTable, eq(mealPlanEntriesTable.recipeId, recipesTable.id))
    .where(and(gte(mealPlanEntriesTable.date, weekStart), lte(mealPlanEntriesTable.date, weekEnd)));

  const groceryItems = await db
    .select()
    .from(groceryListItemsTable)
    .where(eq(groceryListItemsTable.weekStart, weekStart));

  const todayEntries = weekEntryRows
    .filter((row) => row.meal_plan_entries.date === today)
    .map((row) => ({
      id: row.meal_plan_entries.id,
      date: row.meal_plan_entries.date,
      mealSlot: row.meal_plan_entries.mealSlot,
      servings: row.meal_plan_entries.servings,
      recipe: toRecipeSummary(row.recipes),
      createdAt: row.meal_plan_entries.createdAt,
    }));

  const summary = {
    weekStart,
    recipeCount: allRecipes.length,
    mealsPlannedThisWeek: weekEntryRows.length,
    groceryItemCount: groceryItems.length,
    groceryCheckedCount: groceryItems.filter((item) => item.checked).length,
    recentRecipes: allRecipes.slice(0, 5).map(toRecipeSummary),
    todayEntries,
  };

  res.json(GetDashboardSummaryResponse.parse(summary));
});

export default router;
