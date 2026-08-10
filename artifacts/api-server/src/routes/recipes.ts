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
  IngestRecipesBody,
  GenerateRecipeBody,
  ListRecipesResponse,
  CreateRecipeResponse,
  GetRecipeResponse,
  UpdateRecipeResponse,
  ListRecipeTagsResponse,
  IngestRecipesResponse,
  GenerateRecipeResponse,
} from "@workspace/api-zod";
import { extractTextFromPdf, extractRecipesFromText, RecipeIngestionError } from "../lib/recipe-ingestion";
import { generateRecipeFromPrompt, RecipeGenerationError } from "../lib/recipe-generation";
import { retrieveRelevantRecipes } from "../lib/recipe-retrieval";

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

router.post("/recipes/ingest", async (req, res): Promise<void> => {
  const parsed = IngestRecipesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  let text: string;
  try {
    if (body.source === "text") {
      if (!body.text?.trim()) {
        res.status(400).json({ error: "'text' is required when source is 'text'." });
        return;
      }
      text = body.text;
    } else {
      if (!body.fileBase64) {
        res.status(400).json({ error: "'fileBase64' is required when source is 'pdf'." });
        return;
      }
      let buffer: Buffer;
      try {
        buffer = Buffer.from(body.fileBase64, "base64");
      } catch {
        res.status(400).json({ error: "'fileBase64' is not valid base64 data." });
        return;
      }
      if (buffer.length === 0) {
        res.status(400).json({ error: `The uploaded file ${body.fileName ?? ""} was empty.`.trim() });
        return;
      }
      text = await extractTextFromPdf(buffer);
      if (!text.trim()) {
        res.status(422).json({
          error: `No extractable text was found in ${body.fileName ?? "the uploaded PDF"}. It may be a scanned image without a text layer.`,
        });
        return;
      }
    }

    const { recipes, warnings } = await extractRecipesFromText(text);
    res.json(IngestRecipesResponse.parse({ recipes, warnings }));
  } catch (err) {
    if (err instanceof RecipeIngestionError) {
      req.log.warn({ err: err.message }, "Recipe ingestion failed");
      res.status(422).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Unexpected error during recipe ingestion");
    res.status(500).json({ error: "An unexpected error occurred while extracting the recipe." });
  }
});

router.post("/recipes/generate", async (req, res): Promise<void> => {
  const parsed = GenerateRecipeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const candidates = await retrieveRelevantRecipes(parsed.data.prompt);
    const { recipe, inspiredBy } = await generateRecipeFromPrompt(parsed.data.prompt, candidates);
    res.json(GenerateRecipeResponse.parse({ recipe, inspiredBy }));
  } catch (err) {
    if (err instanceof RecipeGenerationError) {
      req.log.warn({ err: err.message }, "Recipe generation failed");
      res.status(422).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Unexpected error during recipe generation");
    res.status(500).json({ error: "An unexpected error occurred while generating the recipe." });
  }
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
