import { PDFParse } from "pdf-parse";
import { getOpenAI, modelFor } from "@workspace/openai";
import type { IngestedRecipe } from "@workspace/api-zod";

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

/** Extracts plain text from a PDF file buffer. */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } catch (err) {
    throw new RecipeIngestionError(
      `Could not read the PDF file. It may be corrupted, password-protected, or contain no extractable text. (${err instanceof Error ? err.message : String(err)})`,
    );
  } finally {
    await parser.destroy();
  }
}

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
          name: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
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
  },
  required: ["title", "description", "servings", "prepMinutes", "cookMinutes", "tags", "ingredients", "instructions"],
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
          "minutes, and any relevant tags (cuisine, meal type, diet). Use null for any field that cannot be determined " +
          "from the text. If this text contains no recognizable recipe (e.g. it's front matter, an index, an unrelated " +
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

  return (parsed.recipes ?? []).filter((r) => r.title?.trim() && r.instructions?.trim());
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
