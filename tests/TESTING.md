# Testing — intent-eval-dashboard

Per the Intent Solutions Testing SOP. The `@intentsolutions/audit-harness` package is vendored as a dev dependency; all hooks and CI workflows reference the in-repo copy.

## Status — v0.1.0 (Phase 1)

The dashboard is in initial scaffolding. The 7-layer taxonomy is not yet fully populated. This document is updated as layers come online.

## Layer status

| Layer | Tool | Status |
|---|---|---|
| L1 — Git hooks | `audit-harness verify` pre-commit | Pending — install after first push |
| L2 — Static (lint/typecheck) | HTML validator + linkchecker on static HTML at v0.1.0; Astro lint + tsc at Phase 2 | Pending — Phase 1 Epic 1.3 |
| L3 — Unit | N/A for single-file HTML; Vitest when Astro adopted at Phase 2 | Pending — Phase 2 |
| L4 — Integration | Vitest + test harness | Pending — Phase 2 |
| L5 — System | Playwright (site build smoke) | Pending — Phase 2 |
| L6 — E2E / acceptance | Gherkin scenarios | Pending — Phase 2 (per `intent-eval-lab` methodology pattern) |
| L7 — Acceptance gates | Required CI checks | Configured in Phase 1 Epic 1.1 deploy workflow |

## Required CI gates (defined per DR-035 § 9)

| Gate | Trigger | Owner |
|---|---|---|
| Partner-name vendor-generic grep | Every PR + push to main | DR-004 S1Q2 (binding) |
| Harness hash verify | Every PR | IS Testing SOP |
| C3 aggregate-PASS% lint | Every PR after Epic 2.3 ships | DR-035 § 4 C3 (CTO+CMO+VP DevRel refusal) |
| Predicate-URI-at-labs scan | Every PR | DR-035 § 4 + CISO refusal — no predicate URI declared under `labs.*` |
| HTML structural diff (A.0 symmetric render) | Every PR touching A.0 rendering | DR-035 § 5 D2 (CTO refusal) |

## Coverage policy

Target: `80%` for kernel-consumer code paths (Phase 2). Not yet measured at Phase 1 (no test code shipped at v0.1.0 scaffolding).

## Mutation policy

Not configured at Phase 1. Will be evaluated against Skill Refiner findings before Phase 2.

## Hash-pinning

After this `TESTING.md` is reviewed and committed, run:

```bash
pnpm exec audit-harness init
```

This hash-pins the policy files. Subsequent AI-proposed edits to this file without re-init will be refused at pre-commit (by design — see IS Testing SOP "When modifying testing policy" workflow).
