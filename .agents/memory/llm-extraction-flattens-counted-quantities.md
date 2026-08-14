---
name: LLM extraction drops the count from "N (X-unit) item" quantities
description: Structured extraction reliably keeps the per-item size and loses the count, turning four fillets into one, and the result looks entirely reasonable.
---

Recipes routinely write a count next to a per-item size: `4 (5-ounce) salmon fillets`,
`2 (15-ounce) cans chickpeas`. Structured extraction into a `{name, quantity, unit}` shape
kept the *size* and dropped the *count* — `quantity: 5, unit: "ounces"` — in **3 of 3**
occurrences in one cookbook, while a plain `2 pounds chicken breasts` on the same page
extracted correctly.

The result is quietly wrong rather than visibly broken: "5 ounces salmon fillets" is a
perfectly plausible ingredient line, so nothing looks amiss until a shopping list is a quarter
of the size it should be, or a nutrition estimate comes in at a third of the published figure.

**Why:** the schema has one numeric slot and the text offers two numbers. Nothing in a bare
`quantity: number` field says which one is meant, and the parenthesised size sits closest to
the unit word, so it wins. This is a schema-design gap, not a model failure — the field was
ambiguous and the model resolved the ambiguity differently than intended.

**How to apply:** say explicitly, in the field description *and* the system prompt, that
quantity is the total the recipe needs and never the size of one item, with a worked example.
Put the per-item size in the name (`name: "5-ounce salmon fillets", quantity: 4`) so total
weight stays recoverable. Field descriptions alone were not enough here — the fix only took
once the rule was in both places, and once `name` also carried an instruction.

Detect existing damage structurally rather than by eye: a plural item noun (fillets, breasts,
chops) with a mass unit on a recipe serving more than one person is the signature. Verify
candidates against the source text before "fixing" them — one such hit in this collection was
genuinely `2 pounds chicken breasts` and correct.

Related: the same extraction path emitted the **string** `"null"` as a unit. See
[[global-no-store-breaks-static-assets]] for the general shape of this — a value that is
invisible in the UI and corrupts matching logic downstream. Normalise `"null"`, `"none"`,
`"n/a"` and empty strings to a real null at the boundary where model output enters the system.
