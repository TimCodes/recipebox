# Per-serving nutrition — implementation plan

Give every recipe per-serving macros: **calories, protein, carbohydrates, fat**. Take them
from the source when the source states them; derive them when it doesn't.

Status: **Phases 1 and 4 (backfill) complete.** 31 of 34 existing recipes now carry the
publisher's own per-serving values, recovered with **no AI calls**. Remaining: phase 2
(estimate the 3 recipes not in the book), phase 3 (USDA grounding), and meal-plan daily totals.

---

## 1. What the data actually looks like

Two measurements taken before designing anything. Both change the shape of the solution.

### 1.1 Your cookbook already contains the answer

The 5-Ingredient Mediterranean cookbook prints a full panel on **101 of 206 pages — one per
recipe, 100% coverage**:

```
PER SERVING: Calories: 189; Protein: 7g; Total Carbohydrates: 14g;
Sugars: 2g; Fiber: 4g; Total Fat: 13g; Saturated Fat: 2g; Cholesterol: 1mg;
```

This text is **already being sent to the model during ingestion and then discarded**, because
`RECIPE_OBJECT_SCHEMA` has no nutrition fields. Capturing it costs one schema change and
roughly 30 extra output tokens per recipe — no extra call, no measurable cost.

Publisher-stated values are also *better* than anything we can compute: they reflect the
actual recipe as tested, not our guess at ingredient weights.

### 1.2 Your existing ingredient data is good, but volume-dominated

Across the 34 saved recipes (238 ingredients, ~7 per recipe):

| | |
| --- | --- |
| recipes with `servings` set | **34 / 34** — per-serving maths is always possible |
| ingredients missing `quantity` | 4 (1%) |
| ingredients missing `unit` | 6 (2%) |
| **volume units** (cup/tbsp/tsp) | **~158 (66%)** |
| count units (large, cloves, medium, head) | ~33 (14%) |
| mass units (oz, lb) | ~29 (12%) |

**Two thirds of ingredients are measured by volume.** That is the crux of the whole problem:
converting volume to mass is ingredient-specific — a cup of flour is ~120g, a cup of water
~240g, a cup of olive oil ~216g. There is no generic cup→gram constant, and the app currently
has *no* unit conversion anywhere (grocery aggregation deliberately matches units exactly and
never converts).

A further 14% are counts — "3 cloves garlic", "2 large eggplants" — which need per-item gram
weights.

**Also found: a data bug.** Six ingredients have the literal string `"null"` as their unit,
rather than a real null. Worth fixing regardless of this feature; it will otherwise silently
corrupt any unit-based logic.

---

## 2. The problem splits in two

1. **Capture** — the source states nutrition. Parse and store it. High confidence, free.
2. **Derive** — the source doesn't. Estimate from ingredients. This is the hard half.

Treat them as separate paths with different confidence, and *say which one produced a number*.
Presenting a publisher's tested panel and our estimate identically would be misleading.

---

## 3. Options for the derive path

### A. Ask the LLM for per-serving macros directly

One call, no new infrastructure, handles messy units and vague quantities gracefully.

Against: not reproducible (same recipe, different answers), no provenance, and models are
genuinely unreliable at arithmetic — summing eight ingredients and dividing by servings is
exactly the kind of multi-step numeric work they slip on. Errors are invisible: a plausible
wrong number looks identical to a right one.

### B. Local food database + our own unit conversion

Deterministic, auditable, free, offline. Against: we must solve ingredient-name matching
("garbanzo beans, rinsed and drained" → "Chickpeas, canned, drained") *and* volume→mass
conversion ourselves. Both are hard; the second is the 66% problem above.

### C. USDA FoodData Central, direct

Public domain, authoritative, and the bulk download includes **`food_portion.csv`** — household
measures with gram weights, which is precisely the missing piece for "1 clove" and "1 cup
chopped". Available as bulk CSV/JSON, or an API (free data.gov key, 1,000 requests/hour/IP).

For recipe ingredients you want **Foundation Foods + SR Legacy** (generic ingredients, ~10k
foods), not Branded Foods (hundreds of thousands of packaged products, mostly noise here).

### D. The Hugging Face datasets you found

Assessed against what this app actually needs:

| dataset | verdict |
| --- | --- |
| `omid5/usda-fdc-foods-cleaned` | **The strongest of the four.** 502k rows, CC0, and it *does* keep `serving_gram_weight` / `serving_description`. Caveat: it appears to carry one serving row per food, whereas FDC's own `food_portion` table has *multiple* portions per food — you need both "1 clove" and "1 cup, chopped" for the same garlic. Worth checking before choosing it over the source. |
| `trentmkelly/US-food-nutrient-data` | Branded packaged products. Useful for "1 jar of X", poor for "2 cloves garlic". Not the primary need. |
| `adarshzolekar/foods-nutrition-dataset` | Small curated calorie/macro list. No portion weights, unclear provenance. Not sufficient alone. |
| `sunli1201/food-nutrients` | Cafeteria plate images with nutrition. Wrong shape entirely — it's for image models, not ingredient lookup. |

**Recommendation: prefer USDA FDC directly** over a mirror. Same public-domain data, fresher,
and the full `food_portion` table is the part that solves the hard problem. Use the HF cleaned
set only if importing FDC proves annoying — it is a reasonable fallback, not a better source.

### E. Commercial natural-language nutrition APIs

Nutritionix, Edamam and Spoonacular accept "1 cup cooked chickpeas" and return macros — they
have already solved parsing *and* conversion, which is most of the work. Spoonacular will even
analyse a whole recipe.

Against: ongoing cost, per-call rate limits, restrictive terms on caching/redistribution, and
an external dependency in a self-hosted app whose whole point was removing platform lock-in.
Worth reconsidering only if the hybrid below proves inaccurate.

### F. **Recommended: hybrid — LLM matches, code computes**

The division of labour that plays to each side's strengths:

1. The **model** receives the ingredient list and, per ingredient, returns a **gram weight**
   and a **food match**. "1/4 cup lemon juice → 61 g, lemon juice raw". Models are good at
   this — it is language and world knowledge, not arithmetic.
2. **Our code** looks up per-100g macros (USDA), multiplies, sums, and divides by servings.
   Deterministic, testable, and correct by construction.

This also yields a **per-ingredient breakdown for free**, which makes the number debuggable
("why is this 900 calories?" → "because it thinks there's 200g of olive oil") and is a genuinely
nice UI feature.

Phase it: ship the model-only version first (Phase 2), then swap the nutrient source to USDA
without changing the API or UI (Phase 3).

---

## 4. Data model

Per-serving macros are 1:1 with a recipe, so columns on `recipes` rather than a new table:

```
calories          integer      null
protein_g         real         null
carbs_g           real         null
fat_g             real         null
nutrition_source  text         null   'stated' | 'estimated' | 'computed' | 'manual'
nutrition_detail  jsonb        null   per-ingredient breakdown, for auditability
nutrition_input   text         null   hash of (ingredients, servings) — staleness detection
nutrition_at      timestamptz  null
```

Notes:

- **`nutrition_source` is not optional polish.** Users must be able to tell a publisher's
  tested panel from our estimate. It drives the UI label and should never be inferred.
- **`nutrition_input` is a hash, not a boolean flag.** A `stale` boolean has to be maintained
  by every write path and will eventually be wrong; a hash of the inputs is computed on read
  and cannot drift. If it differs from the current ingredients+servings, the value is stale.
- `manual` exists so a user correction is never silently overwritten by a recompute.
- The cookbook panel also carries fiber, sugars, saturated fat, cholesterol and sodium. The
  ask is macros, so those stay out of the columns — but they cost nothing extra to capture, so
  keep them in `nutrition_detail` rather than throwing them away a second time.

---

## 5. Phases

### Phase 1 — Capture stated nutrition ✅ DONE

Verified against the cookbook: page 31's printed panel
(`Calories: 189; Protein: 7g; Total Carbohydrates: 14g; ... Sodium: 313mg`) round-tripped
exactly, extras included. A recipe with no panel stored `null` rather than an invented figure.
Staleness, manual override, and all three UI states confirmed in the browser.

<details>
<summary>Original phase 1 plan</summary>

### Phase 1 — Capture stated nutrition (small, high value)

- Add optional nutrition fields to `RECIPE_OBJECT_SCHEMA` in `recipe-ingestion.ts`, which is
  shared by ingestion *and* generation, so both paths populate it from one change.
- Spec → codegen → migration → route handling, per the contract-first workflow.
- Display on the recipe detail page with the source labelled.
- Cost: ~30 extra output tokens per recipe. No extra call.

**Verify:** re-import a few cookbook pages and confirm the panel values land exactly
(`Calories: 189; Protein: 7g` → 189 / 7). Confirm a recipe with no panel stores nulls rather
than invented numbers — the schema must allow null and the prompt must forbid guessing here.

### Phase 2 — Estimate when missing

- `POST /recipes/{id}/nutrition` — computes and stores. Explicit and re-runnable, rather than
  hidden inside recipe creation, so cost is always user-initiated.
- The model returns per-ingredient grams + macros; **the server does the summing and the
  per-serving division**. Never trust model arithmetic.
- Sanity checks before storing: calories should be within ~20% of `4×protein + 4×carbs + 9×fat`;
  reject implausible totals (a 5-ingredient salad at 3,000 kcal/serving is a bug, not a salad).
- Store the breakdown and mark `estimated`.
- Cost: ~$0.0003/recipe on gpt-4o-mini — about **1 cent for all 34 existing recipes**.

**Verify:** spot-check against known values. The cookbook is an ideal test set — estimate a
recipe whose stated panel we already have, and compare. That gives a real accuracy number
rather than a vibe.

### Phase 3 — Ground it in USDA FDC (accuracy upgrade)

- Import Foundation + SR Legacy foods, their nutrients, and `food_portion` into Postgres.
- Model maps ingredient → `fdc_id` + grams; code computes from database values.
- Mark `computed`; keep `estimated` as the fallback when no confident match exists.
- Existing full-text search infrastructure (`to_tsvector`) is already in the codebase and is a
  reasonable first matcher for food names.

**Verify:** re-run the Phase 2 comparison against the stated panels and confirm the error
narrowed. If it didn't, this phase isn't worth keeping — that is a real possible outcome and
worth honouring.

### Phase 4 — Backfill and surface ✅ BACKFILL DONE

Outcome: **31 of 34 recipes backfilled with the publisher's stated values, zero AI calls and
zero cost.**

The panel turned out to be regular enough to parse deterministically
(`parseNutritionPanel` in `lib/nutrition.ts`), so re-running the whole cookbook through the
model was unnecessary — the numbers are printed verbatim in the text. Parsing is also exactly
reproducible, which an extraction call is not.

`artifacts/api-server/src/scripts/backfill-nutrition.ts`, run via
`pnpm --filter @workspace/api-server run backfill-nutrition <pdf> [--apply]`. Dry run by
default; only touches recipes with no nutrition, so it is safe to re-run and never overwrites
a manual correction.

Two parser bugs found by actually running it, both of which produced *plausible* wrong numbers
rather than obvious failures:

1. `Calories: 1,235` parsed as **1** — a digits-only capture stopped at the thousands
   separator. A recipe showing "1 kcal" is visibly wrong; had the value been "1,0xx" it might
   never have been noticed.
2. Label patterns containing top-level alternation (`total\s+fat|...`) bound the value capture
   to the last alternative only, so **fat and carbs silently parsed as null** whenever the
   first alternative matched. Wrapping the label in a non-capturing group fixed it.

Still to do here: meal-plan daily totals, which need `nutrition` on `RecipeSummary`.

<details>
<summary>Original phase 4 plan</summary>

### Phase 4 — Backfill and surface

- **Backfill the 34 existing recipes from the cookbook**: re-run the outline, match candidates
  to saved recipes by title, and fill in the *stated* panel values. These recipes were imported
  before Phase 1, so their real nutrition was extracted and thrown away. This recovers
  publisher-tested numbers rather than estimating — strictly better, and a one-off script.
- Anything unmatched falls back to Phase 2 estimation.
- Surface: recipe detail (full), recipe cards (calories only), and **meal-plan daily totals**,
  which is where per-serving data actually becomes useful day to day.

</details>

---

## 6. Cross-cutting

- **Staleness.** Editing ingredients or servings invalidates nutrition. The input hash makes
  this detectable; the API should return a `nutritionStale` flag and the UI should show it
  rather than quietly displaying a wrong number. Do *not* auto-recompute on every edit — that
  spends money on every keystroke-level save.
- **Manual override.** Let a user correct a value; mark it `manual` and never overwrite.
- **Disclaimer.** Estimates are estimates. A short, non-dramatic note near the numbers is
  appropriate — people do use these for actual dietary decisions.
- **Fix the `"null"`-string units** (§1.2) before building unit logic on top of them.
- **Scaling.** `meal_plan_entries.servings` can differ from the recipe's own servings; day
  totals must scale accordingly rather than assuming one serving.

## 7. Risks

| risk | severity | mitigation |
| --- | --- | --- |
| Volume→mass conversion is wrong for dense/light ingredients | **High** — silently wrong macros | Let the model give gram weights (it knows "1 cup flour ≈ 120g"); validate against USDA portions in Phase 3; show the per-ingredient breakdown so errors are visible |
| Model arithmetic errors | High | Never let it sum or divide; compute in code and cross-check calories against the 4/4/9 rule |
| Ingredient matching picks the wrong food | Medium | Store the match and its confidence; surface low-confidence matches instead of hiding them |
| Nutrition silently goes stale after an edit | Medium | Input hash, surfaced as a flag |
| USDA import is large and fiddly | Low | Foundation + SR Legacy only; skip Branded Foods |

## 8. Open decisions

1. **Scope of "macros".** Four values (calories/protein/carbs/fat) as asked, or also capture
   fiber/sugar/sodium/saturated fat, which the cookbook gives for free? Recommendation: four
   columns, everything else into `nutrition_detail` so it isn't lost.
2. **When to estimate.** On demand (a button), automatically on save, or a bulk "fill gaps"
   action? Recommendation: on demand plus a bulk backfill — keeps spending visible and
   deliberate, consistent with how ingestion now works.
3. **How far to go.** Phase 1 alone may be enough if most recipes come from cookbooks with
   printed panels. Phases 2–3 are only worth it for hand-entered and AI-generated recipes.
   Worth deciding after seeing Phase 1 coverage in practice.
