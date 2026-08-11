/**
 * Model selection, per task rather than one global id.
 *
 * The three AI features have very different cost profiles and very different difficulty:
 *
 *  - `ingest` is the expensive one. It fans out to one call per ~18k-char chunk, up to 12
 *    calls for a single cookbook PDF, on long inputs. It is also the *easiest* task —
 *    mechanical transcription of text that already says what the recipe is, with no
 *    invention required. Cheapest tier.
 *  - `recipe` invents a whole recipe from a short prompt. One call, small input, and
 *    quality is directly visible to the user. Mid tier.
 *  - `mealPlan` is one call but the hardest reasoning: allocate 7+ slots, decide reuse vs.
 *    generate, honour big-batch requests, respect a list of existing recipe ids. Mid tier.
 *
 * Every one is overridable by env so the cost/quality dial can be turned per task without a
 * code change. OPENAI_MODEL overrides the default for all three at once.
 *
 * MEASURED on a single-recipe extraction call (see git history for the benchmark script).
 * Cost is per call, which is what actually matters — not the headline per-token rate:
 *
 *   model                 latency   output tok   reasoning tok   cost/call
 *   gpt-4o-mini             3.0s          268               0   $0.00021   ← ingest default
 *   gpt-5.6-luna            2.0s          264               0   $0.00039
 *   gpt-5-nano:minimal      2.8s          264               0   $0.00012
 *   gpt-5-nano             31.4s        3,367           3,072   $0.00136
 *   gpt-5-mini             20.0s        1,375           1,088   $0.00284
 *
 * Two findings drove the defaults:
 *
 * 1. The gpt-5 family are REASONING models. Left at default effort, gpt-5-nano burned 3,072
 *    reasoning tokens deliberating over mechanical transcription — making the cheapest model
 *    per token 6.4x more expensive and 10x slower per task than gpt-4o-mini. Cheapest per
 *    token is not cheapest per task when output dominates.
 * 2. `reasoning_effort: "minimal"` fixes nano's cost and speed, but it then consistently
 *    (3/3 runs) merged "salt and pepper" into ONE ingredient where gpt-4o-mini split them.
 *    That is not cosmetic here: grocery aggregation matches on exact name, so a merged
 *    ingredient never combines across recipes and yields a junk line. The ~$0.00009/call
 *    saving is not worth a systematic extraction defect.
 *
 * If you do switch ingestion to a gpt-5-family model, pass reasoning_effort: "minimal" or
 * expect the 10x latency — and note that 4o-mini and luna reject that parameter.
 */
export type AiTask = "ingest" | "recipe" | "mealPlan";

const FALLBACK_DEFAULTS: Record<AiTask, string> = {
  // Cheapest *per call* and the most accurate of the cheap tier on ingredient splitting.
  ingest: "gpt-4o-mini",
  // Single-call tasks where output quality is user-visible; cost here is negligible.
  recipe: "gpt-5.6-luna",
  mealPlan: "gpt-5.6-luna",
};

const ENV_VAR: Record<AiTask, string> = {
  ingest: "OPENAI_MODEL_INGEST",
  recipe: "OPENAI_MODEL_RECIPE",
  mealPlan: "OPENAI_MODEL_MEAL_PLAN",
};

/**
 * Resolves the model id for a task: task-specific env var, then the global OPENAI_MODEL
 * override, then the built-in default.
 *
 * NOTE: every task here depends on strict `json_schema` structured outputs. If a cheaper
 * model is substituted that does not support them, the call fails loudly at request time
 * (the API rejects the response_format) rather than silently returning unparseable text.
 */
export function modelFor(task: AiTask): string {
  return (
    process.env[ENV_VAR[task]] ||
    process.env["OPENAI_MODEL"] ||
    FALLBACK_DEFAULTS[task]
  );
}
