import { sql, desc } from "drizzle-orm";
import { db, recipesTable, type Recipe } from "@workspace/db";

/**
 * Retrieval for AI generation is grounded in the user's own recipe collection using
 * Postgres full-text search (to_tsvector/websearch_to_tsquery) over title, description,
 * instructions, and tags — computed live from the current row data on every query.
 *
 * We do NOT use vector embeddings here: neither the OpenAI nor Gemini Replit AI
 * Integrations proxies support an embeddings API (see ai-integrations-openai /
 * ai-integrations-gemini skills), and adding a separate embeddings provider would
 * require a user-supplied API key. Full-text search needs no separate index-maintenance
 * pipeline — because it is computed directly from the live columns, it can never drift
 * out of sync with create/edit/delete the way a stored embeddings index could.
 */
const MAX_CONTEXT_RECIPES = 8;

function searchExpression() {
  return sql`to_tsvector('english', ${recipesTable.title} || ' ' || coalesce(${recipesTable.description}, '') || ' ' || ${recipesTable.instructions} || ' ' || array_to_string(${recipesTable.tags}, ' '))`;
}

/**
 * Returns up to `limit` recipes most relevant to `promptText`, grounding AI generation
 * in the user's own collection. Falls back to the most recently updated recipes when
 * the collection is small or the full-text query matches nothing.
 */
export async function retrieveRelevantRecipes(promptText: string, limit = MAX_CONTEXT_RECIPES): Promise<Recipe[]> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(recipesTable);
  if (!count) return [];

  if (count <= limit) {
    return db.select().from(recipesTable).orderBy(desc(recipesTable.updatedAt));
  }

  const query = promptText.trim();
  let ranked: Recipe[] = [];
  if (query) {
    try {
      ranked = await db
        .select()
        .from(recipesTable)
        .where(sql`${searchExpression()} @@ websearch_to_tsquery('english', ${query})`)
        .orderBy(desc(sql`ts_rank(${searchExpression()}, websearch_to_tsquery('english', ${query}))`))
        .limit(limit);
    } catch {
      // websearch_to_tsquery can reject pathological input (e.g. lone punctuation);
      // fall through to the recency fallback below rather than failing generation.
      ranked = [];
    }
  }

  if (ranked.length > 0) return ranked;

  return db.select().from(recipesTable).orderBy(desc(recipesTable.updatedAt)).limit(limit);
}

/** Lightweight id/title/tags projection of every recipe, used so AI meal-plan generation can reference any existing recipe by id without loading full ingredient/instruction detail for all of them. */
export async function listRecipeLite(): Promise<Pick<Recipe, "id" | "title" | "tags">[]> {
  return db.select({ id: recipesTable.id, title: recipesTable.title, tags: recipesTable.tags }).from(recipesTable);
}
