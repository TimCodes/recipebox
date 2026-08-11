import OpenAI from "openai";

/**
 * Thrown when an AI feature is used but no API key is configured. Routes translate this
 * into a 503 with an actionable message rather than a 500.
 */
export class OpenAINotConfiguredError extends Error {
  constructor() {
    super(
      "AI features are not configured. Set OPENAI_API_KEY (see .env.example) and restart the server.",
    );
    this.name = "OpenAINotConfiguredError";
  }
}

let cached: OpenAI | null = null;

/**
 * Returns the shared OpenAI client, constructing it on first use.
 *
 * Deliberately lazy: the previous Replit-era module threw at *import* time when credentials
 * were missing, which took down the entire API server — recipes, meal plan and grocery list
 * included — because one optional feature was unconfigured. Now only the AI endpoints fail,
 * and they fail with a clear message.
 *
 * OPENAI_BASE_URL is optional and left configurable on purpose: it points this at any
 * OpenAI-compatible endpoint (a local Ollama/LiteLLM proxy, Azure) without a code change.
 */
export function getOpenAI(): OpenAI {
  if (cached) return cached;

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new OpenAINotConfiguredError();

  cached = new OpenAI({
    apiKey,
    baseURL: process.env["OPENAI_BASE_URL"] || undefined,
  });
  return cached;
}

/** True when an API key is present. Used by /healthz to report AI availability. */
export function isOpenAIConfigured(): boolean {
  return Boolean(process.env["OPENAI_API_KEY"]);
}
