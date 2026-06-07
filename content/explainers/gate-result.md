# Gate result

## What it is

This is the **generic explainer** for any gate that does not yet have its own write-up. A `gate-result/v1` is the platform's canonical, signed record of one gate evaluating one thing: it carries a decision (`pass` / `fail` / `advisory` / `error`), a list of structured reasons, a coverage declaration of what was and was not measured, and the identity of the policy and commit it ran against. Every deterministic gate in the ecosystem — coverage, mutation, CRAP, architecture, escape-scan, and more — emits this same shape, which is what lets one dashboard render all of them.

## How we run it

The gate runs in CI, emits its result as a `gate-result/v1` predicate body inside a signed Evidence Bundle, and anchors it in the public Rekor transparency log. This dashboard ingests the bundle, re-verifies the signature and the Rekor inclusion proof, validates the body against the canonical kernel schema, and only then renders it. A result that fails any of those checks does not appear — it is never silently treated as a pass.

## What good looks like

- Read the **decision** and the **verdict** together: `pass` is good; `advisory` is a watch; `fail` is work to do; `error` means the gate could not run and is treated as loudly as a failure.
- The **what to fix** list is the gate's own reasons — the actionable part.
- The **what we measured** block tells you the scope. A narrow scope with a clean pass is weaker evidence than a broad one; a skipped dimension is not a passed one.
