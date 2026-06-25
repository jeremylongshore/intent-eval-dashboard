# Intent Eval Platform — Gemini Code Review style guide

Gemini is the **workhorse code reviewer** for this repo (design · logic · correctness · cross-artifact consistency). CodeQL handles security scanning separately — do **not** duplicate security-vuln findings here. Prioritize the failure classes below; they are the ones deterministic CI gates (lint/typecheck/test/schema-valid) structurally cannot catch.

## Highest-priority checks (one-way-door / signed-artifact repos)

1. **Cross-artifact semantic consistency.** When an entity and a predicate (or any two schemas) reference each other, flag same-named fields whose **type _or_ meaning diverges across files** — e.g. one side `sha256:`-prefixed and the other bare 64-hex; one side "pre-edit input" and the other "post-edit output". ajv/Zod validate each file in isolation and never see the mismatch.
2. **Three-way schema drift.** A change to a JSON Schema must keep its hand-written Zod validator **and** its Python Pydantic model in agreement — especially `required` vs optional, `nullable`, and `enum` boundaries. Flag any validator looser or stricter than its schema, and any hand-authored `_generated/` file that no longer matches its source schema.
3. **Lineage / append-only integrity.** If a doc or `$comment` calls something an "append-only" or "tamper-evident" lineage, the parent link must be a **content hash chain**, not an opaque reassignable UUID. Flag lineage fields that claim integrity but carry only IDs (no self `content_hash`, no `parent_content_hash`).
4. **Closed signed enums (values-vs-types trap).** A closed enum that ships in a signed entry is a `/v2` trigger if it ever widens. Flag closed enums on signed artifacts that lack an explicit open/closed-world posture, and flag a discriminator that double-encodes a fact another field already carries.
5. **Cross-field invariants actually enforced.** If prose/`$comment` states an invariant (e.g. "X iff Y", "revert requires a non-null parent"), flag it if the schema/validator does **not** enforce it. An unenforced invariant on a signed row is a permanent lie waiting to be signed.
6. **Determinism / probabilistic boundary.** An LLM must never author a signed artifact or close a deterministic signal; flag any LLM output path that reaches a signed surface without a deterministic wall (substring pre-check + corpus post-check).
7. **Additive-only discipline.** Kernel schemas/predicates/entities ship in signed `@intentsolutions/core` entries; flag any non-additive change (field removed, type/semantics/enum-value changed, constraint loosened) — those require a Class-1 ISEDC + often a `/v2`.
8. **Governance traceability.** A change citing a Decision Record must not silently resolve a conflict between two ratified clauses; flag unilateral resolutions of contradictory bindings.

## Also flag (normal review)

Correctness bugs, missing edge-case tests (root/empty/null cases), error-handling gaps, security-relevant logic Gemini sees that CodeQL might miss, and comments that claim behavior the code doesn't implement.

## Do NOT

No style nitpicks already covered by ESLint/Prettier/Ruff. No praise-only comments. No security-CVE findings (CodeQL owns those).
