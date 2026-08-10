import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, groceryListItemsTable } from "@workspace/db";
import {
  ListGroceryListItemsQueryParams,
  CreateGroceryListItemBody,
  GenerateGroceryListBody,
  UpdateGroceryListItemParams,
  UpdateGroceryListItemBody,
  DeleteGroceryListItemParams,
  ClearGroceryListQueryParams,
  ListGroceryListItemsResponse,
  CreateGroceryListItemResponse,
  GenerateGroceryListResponse,
  UpdateGroceryListItemResponse,
} from "@workspace/api-zod";
import { toDateString } from "../lib/date";
import { regenerateGroceryListForWeek } from "../lib/grocery";

const router: IRouter = Router();

router.get("/grocery-list", async (req, res): Promise<void> => {
  const query = ListGroceryListItemsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const weekStart = toDateString(query.data.weekStart);

  const items = await db
    .select()
    .from(groceryListItemsTable)
    .where(eq(groceryListItemsTable.weekStart, weekStart))
    .orderBy(groceryListItemsTable.category, groceryListItemsTable.name);

  res.json(ListGroceryListItemsResponse.parse(items));
});

router.post("/grocery-list", async (req, res): Promise<void> => {
  const parsed = CreateGroceryListItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [item] = await db
    .insert(groceryListItemsTable)
    .values({
      weekStart: toDateString(parsed.data.weekStart),
      name: parsed.data.name,
      quantity: parsed.data.quantity ?? null,
      unit: parsed.data.unit ?? null,
      category: parsed.data.category,
      checked: false,
      source: "manual",
    })
    .returning();

  res.status(201).json(CreateGroceryListItemResponse.parse(item));
});

router.delete("/grocery-list", async (req, res): Promise<void> => {
  const query = ClearGroceryListQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const weekStart = toDateString(query.data.weekStart);

  await db.delete(groceryListItemsTable).where(eq(groceryListItemsTable.weekStart, weekStart));

  res.sendStatus(204);
});

router.post("/grocery-list/generate", async (req, res): Promise<void> => {
  const parsed = GenerateGroceryListBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const weekStart = toDateString(parsed.data.weekStart);
  await regenerateGroceryListForWeek(weekStart);

  const items = await db
    .select()
    .from(groceryListItemsTable)
    .where(eq(groceryListItemsTable.weekStart, weekStart))
    .orderBy(groceryListItemsTable.category, groceryListItemsTable.name);

  res.json(GenerateGroceryListResponse.parse(items));
});

router.patch("/grocery-list/:id", async (req, res): Promise<void> => {
  const params = UpdateGroceryListItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateGroceryListItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [item] = await db
    .update(groceryListItemsTable)
    .set(parsed.data)
    .where(eq(groceryListItemsTable.id, params.data.id))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Grocery list item not found" });
    return;
  }

  res.json(UpdateGroceryListItemResponse.parse(item));
});

router.delete("/grocery-list/:id", async (req, res): Promise<void> => {
  const params = DeleteGroceryListItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [item] = await db
    .delete(groceryListItemsTable)
    .where(eq(groceryListItemsTable.id, params.data.id))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Grocery list item not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
