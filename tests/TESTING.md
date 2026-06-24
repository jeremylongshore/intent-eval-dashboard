# Testing — intent-eval-dashboard

Per the Intent Solutions Testing SOP. The `@intentsolutions/audit-harness` package is vendored as a dev dependency; all hooks and CI workflows reference the in-repo copy.

## Status

The TS pipeline test suites are online: 40 Vitest files across `ingest/`, `supervision/`, `results/`, `freshness/`, `retraction/`, `alerting/`, and `internal-testing/` (unit, integration, and synthetic compromised-CI attack scenarios). The taxonomy below is populated for the kernel-consumer code paths; L5 (Playwright site-build smoke) and Gherkin acceptance remain pending. This document is updated as the remaining layers come online.

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
| HTML structural diff (A.0 symmetric render) | Every PR touching A.0 rendering — BUILT (puxu.12): `scripts/lint-arm-symmetry.ts` → `src/results/arm-symmetry-scan.ts`, wired into `deploy.yml` as a required gate + self-check, synthetic fixtures at `src/results/__fixtures__/arm-symmetry-{clean,violation}.html` | DR-035 § 5 D2 + DR-028 (CTO + VP DevRel refusal) |

## Coverage policy

Measured and enforced via Vitest v8 coverage on `src/**/*.ts` (test files, barrels, fixtures, and the no-op publisher stub excluded). The CI floor (`vitest.config.ts` thresholds, run as the `Coverage` gate in `ingest-ci.yml`) is lines 95% / functions 95% / branches 90% / statements 95%.

## Mutation policy

Not configured at Phase 1. Will be evaluated against Skill Refiner findings before Phase 2.

## Hash-pinning

After this `TESTING.md` is reviewed and committed, run:

```bash
pnpm exec audit-harness init
```

This hash-pins the policy files. Subsequent AI-proposed edits to this file without re-init will be refused at pre-commit (by design — see IS Testing SOP "When modifying testing policy" workflow).
