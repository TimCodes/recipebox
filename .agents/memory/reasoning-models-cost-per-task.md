---
name: Cheapest per token is not cheapest per task with reasoning models
description: Picking an LLM by headline per-token price backfires when the model spends reasoning tokens; measure cost per completed call instead.
---

Choosing the ingestion model for this app by advertised input price selected `gpt-5-nano`
($0.05/1M input, the cheapest available). Measured on a real single-recipe extraction it was
the **most expensive practical option and 10x the latency**:

| model | latency | output tok | reasoning tok | cost/call |
| --- | --- | --- | --- | --- |
| gpt-4o-mini | 3.0s | 268 | 0 | $0.00021 |
| gpt-5.6-luna | 2.0s | 264 | 0 | $0.00039 |
| gpt-5-nano `reasoning_effort:minimal` | 2.8s | 264 | 0 | $0.00012 |
| gpt-5-nano (default effort) | 31.4s | 3,367 | 3,072 | $0.00136 |
| gpt-5-mini | 20.0s | 1,375 | 1,088 | $0.00284 |

The gpt-5 family are reasoning models. At default effort `gpt-5-nano` spent 3,072 reasoning
tokens deliberating over mechanical transcription — work the task did not need — and reasoning
tokens bill as output, the expensive side of the ledger.

`reasoning_effort: "minimal"` removed that entirely and made nano genuinely cheapest. But it
then consistently (3/3 runs) merged `"salt and pepper"` into a single ingredient where
`gpt-4o-mini` split them. In this app that is a correctness bug, not a style difference:
grocery aggregation matches on exact ingredient name, so a merged item never combines across
recipes and produces a junk shopping-list line. The ~$0.00009/call saving did not justify it.

**Why:** per-token pricing only predicts cost when models emit comparable numbers of tokens.
For short-input/structured-output work, output volume dominates, and a reasoning model's hidden
token spend can swamp a 4x cheaper input rate. Latency compounds it wherever calls fan out —
here one cookbook import is up to 12 calls, so 31s per call is minutes of wall clock.

**How to apply:** benchmark candidate models on a real payload before fixing a default —
measure latency, `usage.completion_tokens_details.reasoning_tokens`, and cost per *completed
call*. Check output *correctness* on a domain-specific detail, not just that it parsed. Prefer
non-reasoning models for mechanical extraction; if a reasoning model is required, set
`reasoning_effort` explicitly (note non-reasoning models reject that parameter). Make the model
id configurable per task rather than one global constant — different tasks in one app justify
different points on the cost/quality curve.
