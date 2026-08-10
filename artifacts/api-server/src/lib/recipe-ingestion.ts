import { PDFParse } from "pdf-parse";
import { openai } from "@workspace/integrations-openai-ai-server";
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

/** Caps how much raw text we send to the model, to bound cost/latency on very long documents. */
const MAX_INPUT_CHARS = 24000;

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

const RECIPE_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    recipes: {
      type: "array",
      description: "One entry per distinct recipe found in the source text. Empty if no recipe is present.",
      items: {
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
      },
    },
  },
  required: ["recipes"],
  additionalProperties: false,
} as const;

interface ExtractionResult {
  recipes: IngestedRecipe[];
  warnings: string[];
}

/** Runs AI-assisted structured extraction of one or more recipes out of free-form text. */
export async function extractRecipesFromText(rawText: string): Promise<ExtractionResult> {
  const warnings: string[] = [];
  let text = rawText.trim();

  if (!text) {
    throw new RecipeIngestionError("No text content was found to extract a recipe from.");
  }

  if (text.length > MAX_INPUT_CHARS) {
    text = text.slice(0, MAX_INPUT_CHARS);
    warnings.push("The input was long and was truncated before extraction; some later content may have been ignored.");
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-5.6-terra",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content:
          "You extract structured recipe data from raw text that may come from a PDF or a pasted blog/email. " +
          "Identify every distinct recipe present. For each recipe, extract its title, an optional short description, " +
          "ingredients (name, quantity as a number when stated, unit, and best-guess category), full instructions, " +
          "servings, prep time in minutes, cook time in minutes, and any relevant tags (cuisine, meal type, diet). " +
          "Use null for any field that cannot be determined from the text. If the text contains no recognizable recipe " +
          "(e.g. it's an unrelated document, blank, or gibberish), return an empty recipes array — do not invent content.",
      },
      { role: "user", content: text },
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

  const recipes = (parsed.recipes ?? []).filter((r) => r.title?.trim() && r.instructions?.trim());

  if (recipes.length === 0) {
    throw new RecipeIngestionError("No recipe could be found in the provided content.");
  }

  return { recipes, warnings };
}
