import { Router, type IRouter } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, mealPlanEntriesTable, recipesTable } from "@workspace/db";
import {
  ListMealPlanEntriesQueryParams,
  CreateMealPlanEntryBody,
  UpdateMealPlanEntryParams,
  UpdateMealPlanEntryBody,
  DeleteMealPlanEntryParams,
  ListMealPlanEntriesResponse,
  CreateMealPlanEntryResponse,
  UpdateMealPlanEntryResponse,
} from "@workspace/api-zod";
import { toDateString } from "../lib/date";
import { toRecipeSummary } from "../lib/recipe-summary";

const router: IRouter = Router();

router.get("/meal-plan", async (req, res): Promise<void> => {
  const query = ListMealPlanEntriesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const startDate = toDateString(query.data.startDate);
  const endDate = toDateString(query.data.endDate);

  const rows = await db
    .select()
    .from(mealPlanEntriesTable)
    .innerJoin(recipesTable, eq(mealPlanEntriesTable.recipeId, recipesTable.id))
    .where(and(gte(mealPlanEntriesTable.date, startDate), lte(mealPlanEntriesTable.date, endDate)))
    .orderBy(mealPlanEntriesTable.date);

  const entries = rows.map((row) => ({
    id: row.meal_plan_entries.id,
    date: row.meal_plan_entries.date,
    mealSlot: row.meal_plan_entries.mealSlot,
    servings: row.meal_plan_entries.servings,
    recipe: toRecipeSummary(row.recipes),
    createdAt: row.meal_plan_entries.createdAt,
  }));

  res.json(ListMealPlanEntriesResponse.parse(entries));
});

router.post("/meal-plan", async (req, res): Promise<void> => {
  const parsed = CreateMealPlanEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, parsed.data.recipeId));
  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  const [entry] = await db
    .insert(mealPlanEntriesTable)
    .values({
      date: toDateString(parsed.data.date),
      mealSlot: parsed.data.mealSlot,
      recipeId: parsed.data.recipeId,
      servings: parsed.data.servings ?? null,
    })
    .returning();

  res.status(201).json(
    CreateMealPlanEntryResponse.parse({
      id: entry.id,
      date: entry.date,
      mealSlot: entry.mealSlot,
      servings: entry.servings,
      recipe: toRecipeSummary(recipe),
      createdAt: entry.createdAt,
    }),
  );
});

router.patch("/meal-plan/:id", async (req, res): Promise<void> => {
  const params = UpdateMealPlanEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateMealPlanEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (parsed.data.recipeId !== undefined) {
    const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, parsed.data.recipeId));
    if (!recipe) {
      res.status(404).json({ error: "Recipe not found" });
      return;
    }
  }

  const updates: Partial<typeof mealPlanEntriesTable.$inferInsert> = {};
  if (parsed.data.date !== undefined) updates.date = toDateString(parsed.data.date);
  if (parsed.data.mealSlot !== undefined) updates.mealSlot = parsed.data.mealSlot;
  if (parsed.data.recipeId !== undefined) updates.recipeId = parsed.data.recipeId;
  if (parsed.data.servings !== undefined) updates.servings = parsed.data.servings;

  const [updated] = await db
    .update(mealPlanEntriesTable)
    .set(updates)
    .where(eq(mealPlanEntriesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Meal plan entry not found" });
    return;
  }

  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, updated.recipeId));

  res.json(
    UpdateMealPlanEntryResponse.parse({
      id: updated.id,
      date: updated.date,
      mealSlot: updated.mealSlot,
      servings: updated.servings,
      recipe: toRecipeSummary(recipe),
      createdAt: updated.createdAt,
    }),
  );
});

router.delete("/meal-plan/:id", async (req, res): Promise<void> => {
  const params = DeleteMealPlanEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [entry] = await db
    .delete(mealPlanEntriesTable)
    .where(eq(mealPlanEntriesTable.id, params.data.id))
    .returning();

  if (!entry) {
    res.status(404).json({ error: "Meal plan entry not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
