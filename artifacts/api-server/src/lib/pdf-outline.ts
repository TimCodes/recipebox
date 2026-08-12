import { PDFParse } from "pdf-parse";
import type { PdfRecipeCandidate } from "@workspace/api-zod";

/**
 * Locates recipes inside a PDF using local heuristics only — no model call, no tokens.
 *
 * The point is to let the user pick a few recipes out of a large cookbook before anything is
 * sent to the AI. Measured on a 206-page cookbook: extracting three chosen recipes sends
 * ~9.8k characters instead of ~181k, which is one chunk instead of eleven, and returns three
 * recipes instead of sixty. Since output tokens dominate the bill, that is roughly a 95% cost
 * reduction and ~130s -> ~4s.
 */

/** Measurement words. Their density is what separates a recipe page from prose or front matter. */
const UNIT =
  /\b(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|ounces?|oz|pounds?|lbs?|grams?|kg|ml|cloves?|pinch|slices?|cans?|jars?|sprigs?)\b/i;

/** The "SERVES: 4 | PREP TIME: 10 MINUTES" line most cookbooks print directly under the title. */
const META_LINE = /^(serves|makes|yield|servings|prep time|cook time|total time)\b/i;

/** Anywhere-in-page version, used to decide whether a page looks like a recipe at all. */
const META_ANYWHERE = /\b(serves|makes|yield|servings|prep time|cook time)\b/i;

/** Dietary tag lines sit immediately above the title in many books; never mistake one for a title. */
const DIET =
  /\b(vegan|vegetarian|gluten[- ]free|dairy[- ]free|nut[- ]free|paleo|keto|30 minutes or less|one pot|freezer[- ]friendly)\b/i;

/** Front/back matter headings that are never recipe titles. */
const NOISE =
  /^(chapter|contents|table of contents|index|copyright|introduction|acknowledg|about the author|references?|appendix|glossary|notes?|conversion)/i;

const MIN_UNITS_FOR_RECIPE = 3;
/** Guards against a pathological document producing thousands of candidates. */
const MAX_CANDIDATES = 300;

/**
 * PDF text extraction leaves behind soft hyphens, zero-width marks, non-breaking spaces and
 * bidi controls. They are invisible in logs and in a debugger, and they silently break
 * anchored regexes — a line that prints as "SERVES: 8" can fail /^serves/i. Normalise before
 * matching anything.
 */
function clean(line: string): string {
  let out = "";
  for (const ch of line) {
    const c = ch.codePointAt(0)!;
    // Soft hyphen, zero-width marks, bidi controls, word joiner, BOM: drop entirely.
    if (c === 0x00ad || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || c === 0x2060 || c === 0xfeff) {
      continue;
    }
    // Non-breaking / figure / narrow / ideographic spaces: fold to an ordinary space.
    if (c === 0x00a0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x205f || c === 0x3000) {
      out += " ";
      continue;
    }
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

export interface PageText {
  num: number;
  lines: string[];
  text: string;
}

/**
 * Best-effort recipe title.
 *
 * Anchoring on the serves/prep metadata line and taking the line above it is far more reliable
 * than guessing which short line is a heading — cookbooks put the title there almost without
 * exception. Falls back to a generic "short Title Case line" scan for books that don't.
 *
 * This is layout-dependent and will sometimes be wrong, which is why the API also returns the
 * page range and a snippet: the caller should show those so a bad guess is obvious rather than
 * confidently misleading.
 */
function detectTitle(lines: string[]): string | null {
  const metaIdx = lines.findIndex((l) => META_LINE.test(l));

  if (metaIdx > 0) {
    // Walk upward past the dietary tag line, which sits between title and metadata in some books.
    for (let i = metaIdx - 1; i >= 0 && i >= metaIdx - 3; i--) {
      const l = lines[i];
      if (l.length < 4 || l.length > 70) continue;
      if (DIET.test(l) || NOISE.test(l)) continue;
      if (/^\d+$/.test(l)) continue;
      if (UNIT.test(l)) continue;
      return l;
    }
  }

  for (const l of lines.slice(0, 18)) {
    if (l.length < 4 || l.length > 60) continue;
    if (NOISE.test(l) || DIET.test(l) || META_ANYWHERE.test(l)) continue;
    if (/[.:;,]$/.test(l) || /^\d+$/.test(l)) continue;
    if (UNIT.test(l)) continue;
    const words = l.split(" ");
    if (words.length > 9) continue;
    if (words.filter((w) => /^[A-Z0-9]/.test(w)).length / words.length < 0.6) continue;
    return l;
  }

  return null;
}

function countUnits(text: string): number {
  const re = new RegExp(UNIT.source, "gi");
  return (text.match(re) ?? []).length;
}

export interface PdfOutline {
  pageCount: number;
  candidates: PdfRecipeCandidate[];
  /** Full page text, kept so a caller can extract selected pages without re-parsing the file. */
  pages: PageText[];
}

/** Splits already-extracted page text into recipe candidates. Exported for testing. */
export function outlineFromPages(pages: PageText[]): PdfRecipeCandidate[] {
  const starts: Array<{ page: number; title: string }> = [];

  for (const page of pages) {
    if (countUnits(page.text) < MIN_UNITS_FOR_RECIPE) continue;
    // Require a line that *starts* with serves/prep/yield, not merely the word somewhere on
    // the page. Ingredient-dense front matter — "stock your pantry" and "in the fridge"
    // pages — mentions these words in prose and would otherwise be detected as a recipe,
    // producing a bogus entry whose range then swallows the pages up to the first real one.
    if (!page.lines.some((l) => META_LINE.test(l))) continue;
    const title = detectTitle(page.lines);
    if (!title) continue;
    starts.push({ page: page.num, title });
    if (starts.length >= MAX_CANDIDATES) break;
  }

  return starts.map((start, i) => {
    // A recipe runs until the next one begins. This is the reason the API returns a range at
    // all: over half the recipes in a real cookbook span more than one page, so letting the
    // user select a single page would silently truncate them mid-instructions.
    const nextStart = i + 1 < starts.length ? starts[i + 1].page : pages.length + 1;
    const endPage = Math.max(start.page, nextStart - 1);

    const body = pages
      .filter((p) => p.num >= start.page && p.num <= endPage)
      .flatMap((p) => p.lines);
    const snippet = body
      .filter((l) => l !== start.title)
      .slice(0, 4)
      .join(" · ")
      .slice(0, 240);

    return { startPage: start.page, endPage, title: start.title, snippet };
  });
}

export class PdfOutlineError extends Error {}

/**
 * Extracts normalised per-page text. Shared by the outline endpoint and by ingestion, so
 * selective ingestion can pull just the chosen pages without a second parse or a second
 * normalisation rule.
 */
export async function extractPdfPages(buffer: Buffer): Promise<PageText[]> {
  const parser = new PDFParse({ data: buffer });
  let pages: PageText[];

  try {
    const result = await parser.getText();
    pages = result.pages.map((p) => {
      const lines = p.text.split("\n").map(clean).filter(Boolean);
      return { num: p.num, lines, text: lines.join("\n") };
    });
  } catch (err) {
    throw new PdfOutlineError(
      `Could not read the PDF file. It may be corrupted, password-protected, or contain no extractable text. (${err instanceof Error ? err.message : String(err)})`,
    );
  } finally {
    await parser.destroy();
  }

  if (!pages.some((p) => p.text.trim())) {
    throw new PdfOutlineError(
      "No extractable text was found in this PDF. It may be a scanned image without a text layer.",
    );
  }

  return pages;
}

/** Extracts page text and locates the recipes in it. No model call. */
export async function outlinePdf(buffer: Buffer): Promise<PdfOutline> {
  const pages = await extractPdfPages(buffer);
  return { pageCount: pages.length, candidates: outlineFromPages(pages), pages };
}

/** Joins the text of the given 1-based page numbers, in document order. */
export function textForPages(pages: PageText[], selected: number[]): string {
  const wanted = new Set(selected);
  return pages
    .filter((p) => wanted.has(p.num))
    .map((p) => p.text)
    .join("\n\n");
}
