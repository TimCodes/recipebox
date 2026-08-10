---
name: AI extraction on long documents needs chunking, not truncation
description: Why naively capping input length before an LLM extraction call silently drops most of a long document's content.
---

When extracting structured data (e.g. recipes) from long documents (e.g. a 200-page
cookbook PDF) via an LLM, do not simply truncate the extracted text to a fixed character
budget before sending it to the model. Front matter (covers, copyright pages, intros)
often occupies the entire truncated slice, so the model correctly reports "nothing found"
even though the real content is later in the document — this looks like an extraction
bug but is actually a data-loss bug upstream of the model call.

**Why:** LLM context windows are large but not unlimited, and cost/latency scale with
input size, so *some* cap is reasonable — the bug is capping via truncation instead of
coverage.

**How to apply:** Split long input into chunks on natural boundaries (paragraph breaks),
run extraction per chunk (with bounded concurrency), merge results across chunks, and cap
the total number of extracted items with a warning message if the cap is hit — rather
than capping input characters and silently ignoring everything past the cutoff.
