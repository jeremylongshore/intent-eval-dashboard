# Testing — intent-eval-dashboard

Per the Intent Solutions Testing SOP. The `@intentsolutions/audit-harness` package is vendored as a dev dependency; all hooks and CI workflows reference the in-repo copy.

## Status — v0.1.0 (Phase 1)

The dashboard is in initial scaffolding. The 7-layer taxonomy is not yet fully populated. This document is updated as layers come online.

## Layer status

| Layer | Tool | Status |
|---|---|---|
| L1 — Git hooks | `audit-harness verify` pre-commit | `.harness-hash` pinned; wire pre-commit hook after first push |
| L2 — Static (lint/typecheck) | ESLint (typed) + `tsc --noEmit` on `src/`/`ingest/`; HTML validator on static HTML | ONLINE for the TS ingest pipeline (Phase 2 Epic 2.2) |
| L3 — Unit | Vitest — supervision semantics + each verification step (real pass + real fail) | ONLINE (Phase 2 Epic 2.2) |
| L4 — Integration | Vitest — full deploy-pass (worker → supervisor → renderer → publisher) | ONLINE (Phase 2 Epic 2.2) |
| L5 — System | Playwright (site build smoke) | Pending — Astro adoption |
| L6 — E2E / acceptance | Synthetic compromised-CI attack scenarios (Vitest) + Gherkin later | Attack scenarios ONLINE (Phase 2 Epic 2.2); Gherkin pending |
| L7 — Acceptance gates | Required CI checks (`ingest-ci.yml` full gate + coverage + harness verify) | ONLINE for ingest (Phase 2 Epic 2.2); deploy gate per Epic 1.1 |

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
