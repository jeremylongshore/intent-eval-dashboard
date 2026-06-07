# How to read this dashboard

This is the **internal testing dashboard** — a guided tour of how well-tested the Intent Eval Platform repos are, and what to fix next. It is not a spreadsheet. Every gate below is explained: what it measures, how we run it, and what a healthy number looks like, next to our actual result and a plain-English verdict.

## What you are looking at

Each repo has its own page. On it, every testing **gate** appears as a block with five parts:

- **The explainer** — what this gate is, how we run it, and what good looks like. Written once, reused everywhere.
- **The data** — our actual result for this gate, with four timestamps (when it was evaluated, when the evidence bundle was created, its Rekor transparency-log anchor, and when this dashboard ingested it).
- **The verdict** — a one-line reading: `good`, `watch`, `fail`, or `error`.
- **What we measured** — the dimensions the gate evaluated, and any it skipped. A skipped dimension is never counted as a passed one.
- **What to fix** — the gate's own list of reasons, verbatim. This is the actionable part: it tells you exactly what is failing and why.

## How to read the verdicts

- **`good`** — the gate passed: it meets the policy bar.
- **`watch`** — an advisory. Not blocking, but worth attention before it becomes a failure.
- **`fail`** — below the policy bar. The **what to fix** list is the work to do.
- **`error`** — the gate could not evaluate. This is **not** a pass — it means we do not know, and it is shown as loudly as a failure.

## Two honesty rules baked in

- **`no-data` is not a pass.** A repo that has not published a verified result is shown loudly, with the same visual weight as a failure — never as a clean blank.
- **No laundered pass-rates.** We never composite an aggregate "percent passing" across different kinds of gate. Each gate is read on its own terms.

Every result here is signed, anchored in the public Rekor transparency log, and re-verified the moment this dashboard ingests it. If a result cannot be verified, it does not appear — it is not silently treated as a pass.
