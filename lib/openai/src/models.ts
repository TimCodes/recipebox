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
 * Indicative list pricing per 1M tokens (input/output) at time of writing — verify before
 * relying on it, these move:
 *   gpt-5-nano      $0.05 / $0.40     ← cheapest available
 *   gpt-4o-mini     $0.15 / $0.60
 *   gpt-5.6-luna    $0.20 / $1.20
 *   gpt-5-mini      $0.25 / $2.00
 *   gpt-5.6-terra   $2.00 / $12.00    ← what the app used on Replit
 */
export type AiTask = "ingest" | "recipe" | "mealPlan";

const FALLBACK_DEFAULTS: Record<AiTask, string> = {
  ingest: "gpt-5-nano",
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
