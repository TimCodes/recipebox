import { readFileSync } from "node:fs";
import { eq, isNull } from "drizzle-orm";
import { db, recipesTable, pool } from "@workspace/db";
import { outlinePdf, type PageText } from "../lib/pdf-outline";
import { parseNutritionPanel, toNutritionColumns } from "../lib/nutrition";

/**
 * Backfills per-serving nutrition for recipes imported from a cookbook before nutrition
 * capture existed (see NUTRITION_PLAN.md phase 4).
 *
 * Uses **no AI at all**. The panel is printed verbatim in the source and is regular enough to
 * parse, so this recovers the publisher's own tested numbers rather than paying a model to
 * estimate values that are already written down. Stated beats estimated every time, and the
 * whole run is free and exactly reproducible.
 *
 *   node dist/scripts/backfill-nutrition.mjs <cookbook.pdf> [--apply]
 *
 * Defaults to a dry run. Only touches recipes that currently have no nutrition, so re-running
 * it is safe and it will never overwrite a value someone corrected by hand.
 */

/** Titles vary in punctuation and case between the PDF and what was saved; compare on the letters. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textForRange(pages: PageText[], startPage: number, endPage: number): string {
  return pages
    .filter((p) => p.num >= startPage && p.num <= endPage)
    .map((p) => p.text)
    .join("\n");
}

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  const apply = process.argv.includes("--apply");

  if (!pdfPath) {
    console.error("usage: backfill-nutrition.mjs <cookbook.pdf> [--apply]");
    process.exit(1);
  }

  console.log(`Reading ${pdfPath}${apply ? "" : "   (DRY RUN — pass --apply to write)"}`);
  const { pageCount, candidates, pages } = await outlinePdf(readFileSync(pdfPath));
  console.log(`  ${pageCount} pages, ${candidates.length} recipes detected\n`);

  // Index the book's recipes by normalised title, keeping the parsed panel for each.
  const fromBook = new Map<string, ReturnType<typeof parseNutritionPanel>>();
  let panelsFound = 0;
  for (const c of candidates) {
    const nutrition = parseNutritionPanel(textForRange(pages, c.startPage, c.endPage));
    if (nutrition) panelsFound += 1;
    fromBook.set(normalizeTitle(c.title), nutrition);
  }
  console.log(`  panels parsed: ${panelsFound}/${candidates.length}\n`);

  const targets = await db.select().from(recipesTable).where(isNull(recipesTable.nutritionSource));
  console.log(`Recipes currently without nutrition: ${targets.length}\n`);

  const matched: Array<{ id: number; title: string; calories: number | null }> = [];
  const unmatched: string[] = [];
  const noPanel: string[] = [];

  for (const recipe of targets) {
    const key = normalizeTitle(recipe.title);
    if (!fromBook.has(key)) {
      unmatched.push(recipe.title);
      continue;
    }
    const nutrition = fromBook.get(key);
    if (!nutrition) {
      noPanel.push(recipe.title);
      continue;
    }

    matched.push({ id: recipe.id, title: recipe.title, calories: nutrition.calories });

    if (apply) {
      await db
        .update(recipesTable)
        .set(toNutritionColumns(nutrition, recipe.ingredients, recipe.servings))
        .where(eq(recipesTable.id, recipe.id));
    }
  }

  for (const m of matched) {
    console.log(`  ${apply ? "updated" : "would update"}  #${m.id}  ${m.title} — ${m.calories} kcal`);
  }
  if (noPanel.length > 0) {
    console.log(`\n  matched the book but no panel on those pages (${noPanel.length}):`);
    for (const t of noPanel) console.log(`    ${t}`);
  }
  if (unmatched.length > 0) {
    console.log(`\n  not found in this book (${unmatched.length}) — these need phase 2 estimation:`);
    for (const t of unmatched) console.log(`    ${t}`);
  }

  console.log(
    `\n${apply ? "Updated" : "Would update"} ${matched.length} of ${targets.length} recipes.` +
      (apply ? "" : "\nRe-run with --apply to write."),
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
