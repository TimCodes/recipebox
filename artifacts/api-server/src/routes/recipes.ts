import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, recipesTable, type Recipe as RecipeRow } from "@workspace/db";
import {
  ListRecipesQueryParams,
  CreateRecipeBody,
  GetRecipeParams,
  UpdateRecipeParams,
  UpdateRecipeBody,
  DeleteRecipeParams,
  ListRecipesResponse,
  CreateRecipeResponse,
  GetRecipeResponse,
  UpdateRecipeResponse,
  ListRecipeTagsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function matchesSearch(recipe: RecipeRow, search: string): boolean {
  const needle = search.toLowerCase();
  if (recipe.title.toLowerCase().includes(needle)) return true;
  if (recipe.tags.some((tag) => tag.toLowerCase().includes(needle))) return true;
  if (recipe.ingredients.some((ing) => ing.name.toLowerCase().includes(needle))) return true;
  return false;
}

router.get("/recipes", async (req, res): Promise<void> => {
  const query = ListRecipesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let recipes = await db.select().from(recipesTable).orderBy(recipesTable.createdAt);

  if (query.data.search) {
    recipes = recipes.filter((recipe) => matchesSearch(recipe, query.data.search!));
  }
  if (query.data.tag) {
    recipes = recipes.filter((recipe) => recipe.tags.includes(query.data.tag!));
  }

  res.json(ListRecipesResponse.parse(recipes));
});

router.post("/recipes", async (req, res): Promise<void> => {
  const parsed = CreateRecipeBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid recipe body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [recipe] = await db
    .insert(recipesTable)
    .values({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      ingredients: parsed.data.ingredients,
      instructions: parsed.data.instructions,
      servings: parsed.data.servings ?? null,
      prepMinutes: parsed.data.prepMinutes ?? null,
      cookMinutes: parsed.data.cookMinutes ?? null,
      tags: parsed.data.tags ?? [],
      photoUrl: parsed.data.photoUrl ?? null,
    })
    .returning();

  res.status(201).json(CreateRecipeResponse.parse(recipe));
});

router.get("/recipes/tags", async (_req, res): Promise<void> => {
  const recipes = await db.select({ tags: recipesTable.tags }).from(recipesTable);
  const tagSet = new Set<string>();
  for (const recipe of recipes) {
    for (const tag of recipe.tags) tagSet.add(tag);
  }
  res.json(ListRecipeTagsResponse.parse(Array.from(tagSet).sort()));
});

router.get("/recipes/:id", async (req, res): Promise<void> => {
  const params = GetRecipeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [recipe] = await db.select().from(recipesTable).where(eq(recipesTable.id, params.data.id));

  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  res.json(GetRecipeResponse.parse(recipe));
});

router.patch("/recipes/:id", async (req, res): Promise<void> => {
  const params = UpdateRecipeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateRecipeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [recipe] = await db
    .update(recipesTable)
    .set(parsed.data)
    .where(eq(recipesTable.id, params.data.id))
    .returning();

  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  res.json(UpdateRecipeResponse.parse(recipe));
});

router.delete("/recipes/:id", async (req, res): Promise<void> => {
  const params = DeleteRecipeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [recipe] = await db.delete(recipesTable).where(eq(recipesTable.id, params.data.id)).returning();

  if (!recipe) {
    res.status(404).json({ error: "Recipe not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
