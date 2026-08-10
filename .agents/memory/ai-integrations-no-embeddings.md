---
name: AI Integrations proxies lack an embeddings API
description: Neither OpenAI nor Gemini via Replit AI Integrations expose embeddings — plan RAG retrieval without vector search unless the user supplies their own API key.
---

Both the OpenAI and Gemini Replit AI Integrations proxy skills explicitly list embeddings under
"Unsupported Capabilities." There is no way to get a vector-embeddings endpoint through either
proxy without the user supplying their own provider API key (which is a separate ask, not implied
by "add AI features").

**Why:** A RAG/semantic-search feature request will default in most engineers' minds to "generate
embeddings, store in a vector column, do cosine similarity." That path is a dead end here — check
the integration skill's unsupported-capabilities list *before* designing storage/indexing around
embeddings, or the design will need to be reworked mid-task.

**How to apply:** When asked to build retrieval/semantic-search/RAG grounded in a user's own data,
and only AI Integrations proxies are available (no dedicated embeddings provider connected), use a
non-vector retrieval strategy instead — e.g. Postgres full-text search (`to_tsvector` /
`websearch_to_tsquery` / `ts_rank`) computed live from the source columns. Computing it live (not
as a stored/generated column) also sidesteps needing to keep an index in sync on every
create/edit/delete. If true semantic similarity is later required, that needs either a
user-supplied embeddings API key or a different connected integration — surface that constraint to
the user rather than silently approximating it.
