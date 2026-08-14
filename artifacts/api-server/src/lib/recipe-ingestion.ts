import { getOpenAI, modelFor } from "@workspace/openai";
import type { IngestedRecipe, NutritionInput } from "@workspace/api-zod";

export const INGREDIENT_CATEGORIES = [
  "produce",
  "dairy",
  "meat_seafood",
  "bakery",
  "pantry",
  "frozen",
  "beverages",
  "spices",
  "other",
] as const;

/**
 * Full cookbooks can run to hundreds of pages / 150k+ characters of extracted text — far more
 * than fits in one model call. Rather than truncating to the first CHUNK_CHARS (which silently
 * drops everything after the cover page, copyright notice, and intro — the actual failure mode
 * that motivated this comment), we split the text into chunks and extract from each one,
 * merging the results. MAX_CHUNKS bounds total cost/latency on extreme inputs; CHUNK_CONCURRENCY
 * bounds how many chunk calls run in parallel.
 */
const CHUNK_CHARS = 18000;
const MAX_CHUNKS = 12;
const CHUNK_CONCURRENCY = 4;
/** Caps how many recipes we return from one ingest, so the review UI stays usable for huge cookbooks. */
const MAX_RECIPES_RETURNED = 60;

export class RecipeIngestionError extends Error {}

/**
 * JSON schema for a single structured recipe object, shared by every AI call that
 * produces a recipe draft (ingestion extraction, and AI-assisted generation).
 */
export const RECIPE_OBJECT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: ["string", "null"] },
    servings: { type: ["integer", "null"] },
    prepMinutes: { type: ["integer", "null"] },
    cookMinutes: { type: ["integer", "null"] },
    tags: { type: "array", items: { type: "string" } },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "The ingredient. When the recipe states a per-item size alongside a count, fold that size into the name — '4 (5-ounce) salmon fillets' becomes name '5-ounce salmon fillets' with quantity 4 — so the total weight stays recoverable. Do not repeat the unit word in the name.",
          },
          quantity: {
            type: ["number", "null"],
            description:
              "The TOTAL amount the whole recipe needs — never the size of a single item. Recipes often write a count next to a per-item size, e.g. '4 (5-ounce) salmon fillets' or '2 (15-ounce) cans chickpeas'. There the total is 4 fillets and 2 cans; 5 and 15 are item sizes and must not be used as the quantity. Null only if no amount is given at all.",
          },
          unit: {
            type: ["string", "null"],
            description:
              "Unit for the quantity. For counted items use the item word ('fillets', 'cans', 'cloves') or null, never the unit from the per-item size. Leave null if the item word is already the end of the name.",
          },
          category: { type: "string", enum: INGREDIENT_CATEGORIES },
        },
        required: ["name", "quantity", "unit", "category"],
        additionalProperties: false,
      },
    },
    instructions: {
      type: "string",
      description: "Numbered or step-by-step instructions, newline separated.",
    },
    nutrition: {
      anyOf: [
        {
          type: "object",
          properties: {
            calories: { type: ["integer", "null"], description: "kcal per serving" },
            proteinG: { type: ["number", "null"] },
            carbsG: { type: ["number", "null"] },
            fatG: { type: ["number", "null"] },
            fiberG: { type: ["number", "null"] },
            sugarG: { type: ["number", "null"] },
            saturatedFatG: { type: ["number", "null"] },
            cholesterolMg: { type: ["number", "null"] },
            sodiumMg: { type: ["number", "null"] },
          },
          required: [
            "calories",
            "proteinG",
            "carbsG",
            "fatG",
            "fiberG",
            "sugarG",
            "saturatedFatG",
            "cholesterolMg",
            "sodiumMg",
          ],
          additionalProperties: false,
        },
        { type: "null" },
      ],
      description:
        "Per-serving nutrition ONLY if the source text explicitly states it (e.g. a 'PER SERVING: Calories: 189; Protein: 7g' panel). Null if the source does not state it. Never estimate or calculate these — an estimate is indistinguishable from a printed panel once stored.",
    },
  },
  required: ["title", "description", "servings", "prepMinutes", "cookMinutes", "tags", "ingredients", "instructions", "nutrition"],
  additionalProperties: false,
} as const;

const RECIPE_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    recipes: {
      type: "array",
      description: "One entry per distinct recipe found in the source text. Empty if no recipe is present.",
      items: RECIPE_OBJECT_SCHEMA,
    },
  },
  required: ["recipes"],
  additionalProperties: false,
} as const;

/**
 * Normalises an extracted ingredient.
 *
 * Models occasionally emit the *string* "null" (or "none", or an empty string) for a unit that
 * should simply be absent. It reads as a real unit everywhere downstream — grocery aggregation
 * matches on name+unit, so `"null"` silently becomes its own shopping category — and it is
 * invisible in any UI that just prints the value.
 */
function normalizeIngredient<T extends { unit?: string | null; name: string }>(ingredient: T): T {
  const unit = ingredient.unit?.trim() ?? null;
  const bogus = unit === null || unit === "" || /^(null|undefined|none|n\/a)$/i.test(unit);
  return { ...ingredient, unit: bogus ? null : unit, name: ingredient.name.trim() };
}

/** Shape the extraction model returns for `nutrition` — macros plus whatever else the panel listed. */
interface RawNutrition {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarG: number | null;
  saturatedFatG: number | null;
  cholesterolMg: number | null;
  sodiumMg: number | null;
}

/**
 * Folds the model's flat nutrition object into the API shape: four macros as first-class
 * fields, everything else preserved under `extras` rather than discarded.
 *
 * Always tagged `stated`, because the schema and prompt only permit this field to be filled
 * from an explicit panel in the source. Returns undefined when every macro is null, so a
 * recipe with no panel stores no nutrition at all instead of a row of nulls that reads as
 * "we looked and it has zero calories".
 */
function toNutritionInput(raw: RawNutrition | null | undefined): NutritionInput | undefined {
  if (!raw) return undefined;
  if (raw.calories == null && raw.proteinG == null && raw.carbsG == null && raw.fatG == null) {
    return undefined;
  }

  const extras: Record<string, number> = {};
  if (raw.fiberG != null) extras["fiberG"] = raw.fiberG;
  if (raw.sugarG != null) extras["sugarG"] = raw.sugarG;
  if (raw.saturatedFatG != null) extras["saturatedFatG"] = raw.saturatedFatG;
  if (raw.cholesterolMg != null) extras["cholesterolMg"] = raw.cholesterolMg;
  if (raw.sodiumMg != null) extras["sodiumMg"] = raw.sodiumMg;

  return {
    calories: raw.calories,
    proteinG: raw.proteinG,
    carbsG: raw.carbsG,
    fatG: raw.fatG,
    source: "stated",
    ...(Object.keys(extras).length > 0 ? { extras } : {}),
  };
}

interface ExtractionResult {
  recipes: IngestedRecipe[];
  warnings: string[];
}

/** Splits text into chunks near paragraph boundaries (so recipes aren't split mid-way when avoidable), capped at maxChunks. */
function splitIntoChunks(text: string, chunkSize: number, maxChunks: number): { chunks: string[]; truncated: boolean } {
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length && chunks.length < maxChunks) {
    let end = Math.min(pos + chunkSize, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n\n", end);
      if (boundary > pos + chunkSize * 0.5) {
        end = boundary;
      }
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return { chunks, truncated: pos < text.length };
}

/** Runs one structured-extraction model call over a single chunk of text. Returns [] if no recipe is present in the chunk. */
async function extractRecipesFromChunk(chunk: string): Promise<IngestedRecipe[]> {
  const completion = await getOpenAI().chat.completions.create({
    model: modelFor("ingest"),
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You extract structured recipe data from raw text that may come from a PDF (possibly just one section/chunk " +
          "of a larger cookbook) or a pasted blog/email. Identify every distinct recipe present in THIS text. For each " +
          "recipe, extract its title, an optional short description, ingredients (name, quantity as a number when " +
          "stated, unit, and best-guess category), full instructions, servings, prep time in minutes, cook time in " +
          "minutes, and any relevant tags (cuisine, meal type, diet). If the text prints a per-serving nutrition panel, copy those numbers into `nutrition` exactly as stated; if it does not, set `nutrition` to null — never compute or estimate it. Use null for any field that cannot be determined " +
          "from the text. An ingredient's quantity is always the total the recipe needs: for a line like " +
          "'4 (5-ounce) salmon fillets' the quantity is 4 and the name should carry the size ('5-ounce salmon " +
          "fillets'), because recording 5 would silently turn four fillets into one. " +
          "If this text contains no recognizable recipe (e.g. it's front matter, an index, an unrelated " +
          "section, blank, or gibberish), return an empty recipes array — do not invent content.",
      },
      { role: "user", content: chunk },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "recipe_extraction",
        strict: true,
        schema: RECIPE_EXTRACTION_SCHEMA,
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new RecipeIngestionError("The extraction service returned an empty response.");
  }

  let parsed: { recipes: IngestedRecipe[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new RecipeIngestionError("The extraction service returned a malformed response.");
  }

  return (parsed.recipes ?? [])
    .filter((r) => r.title?.trim() && r.instructions?.trim())
    .map((r) => ({
      ...r,
      ingredients: (r.ingredients ?? []).map(normalizeIngredient),
      nutrition: toNutritionInput((r as { nutrition?: RawNutrition | null }).nutrition) ?? null,
    }));
}

/** Runs a set of async tasks with a concurrency cap, preserving input order in the results. */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

/** Runs AI-assisted structured extraction of one or more recipes out of free-form text, chunking large documents (e.g. full cookbooks) so content isn't silently dropped. */
export async function extractRecipesFromText(rawText: string): Promise<ExtractionResult> {
  const warnings: string[] = [];
  const text = rawText.trim();

  if (!text) {
    throw new RecipeIngestionError("No text content was found to extract a recipe from.");
  }

  const { chunks, truncated } = splitIntoChunks(text, CHUNK_CHARS, MAX_CHUNKS);
  if (truncated) {
    warnings.push(
      `This document is very long, so only the first ~${Math.round((CHUNK_CHARS * MAX_CHUNKS) / 1000)}k characters were scanned for recipes; some later content may have been skipped.`,
    );
  }

  const chunkResults = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, extractRecipesFromChunk);
  let recipes = chunkResults.flat();

  if (recipes.length === 0) {
    throw new RecipeIngestionError("No recipe could be found in the provided content.");
  }

  if (recipes.length > MAX_RECIPES_RETURNED) {
    recipes = recipes.slice(0, MAX_RECIPES_RETURNED);
    warnings.push(`Found more than ${MAX_RECIPES_RETURNED} recipes — showing the first ${MAX_RECIPES_RETURNED} for review.`);
  }

  return { recipes, warnings };
}
