# TEST_AUDIT.md — intent-eval-dashboard

> Diagnostic produced by `/audit-tests` (7-layer + gate sweep). Date: 2026-07-13.
> Scope: the public reports dashboard for the Intent Eval Platform — the Node/TS
> ingest → verify → supervise → render → publish pipeline (`src/`, `ingest/`,
> `scripts/`, `site/`) that turns signed Evidence Bundles into the static surface
> at `labs.intentsolutions.io`. Consumes `@intentsolutions/core` as a pinned dep.

## Grade: B+ (88/100)

Substantively excellent test *content* — 437 Vitest tests across 43 files, all
green, at ~99% line / 92% branch coverage with an enforced CI floor — plus a set
of genuinely sophisticated domain-refusal gates (the C3 aggregate-PASS% scanner
and the arm-symmetry HTML structural-diff, each with a self-check that inverts a
known-violation fixture's exit code so a neutered scanner is itself caught). Held
below A by an enforcement/hygiene gap, not a coverage gap: the harness hash-pin
and the local pre-commit mirror that `tests/TESTING.md` describes as active
controls were never activated (`.harness-hash` is 0 bytes → `harness:verify`
passes trivially; no git hook is wired), and two taxonomy layers (L5 Playwright
site smoke, L6 Gherkin acceptance) remain honestly-documented "pending."

## Classification

**Static-site generator + signed-artifact verification pipeline (Node/TS,
library-shaped).** The repo owns the ingest/verification path (fetch → verify
DSSE + Rekor inclusion + schema → content-address → supervise → render HTML →
publish) plus retraction, freshness, skills, and alerting renderers. There is no
long-running service; the deployable is committed static HTML under `site/` +
`site-internal/`. Toolchain: **pnpm + TypeScript + Vitest** (not Bun). The
cryptographic kernel (schemas/validators) lives in `@intentsolutions/core`; only
render/verify logic is in-tree.

## 7-layer presence / config / enforcement

| Layer | State | Evidence |
|---|---|---|
| L1 — git hooks & CI | ◑ CI-only | **8 CI workflows** (`ingest-ci`, `deploy`, `codeql`, `doc-quality`, `lint`, `partner-name-guard`, `typos`, `regenerate`). **No local pre-commit hook** — `core.hooksPath` unset, no non-sample hooks, no `.beads/hooks`; `tests/TESTING.md` says "wire pre-commit hook after first push" — not done. All enforcement is CI-side. |
| L2 — static / lint / types | ✅ HARD | strict `tsc --noEmit`, typed ESLint (`eslint.config.js`), `yamllint --strict` + `actionlint` (`lint.yml`), `typos` (`typos.yml`), markdownlint + lychee (`doc-quality.yml`). All green. |
| L3 — unit & function | ✅ HARD | **437 tests / 43 colocated `*.test.ts`** across `ingest/ supervision/ results/ freshness/ retraction/ skills/ alerting/ internal-testing/`; real pass + real fail per verification step; coverage floor enforced in CI (`vitest.config.ts` thresholds, `Coverage` step in `ingest-ci.yml`). |
| L4 — integration | ✅ | full deploy-pass exercised end-to-end (worker → supervisor → renderer → publisher), gate-row store, ingest against **real crypto fixtures** (sigstore/offline verifiers), partial-fetch last-known-good, live-pass. |
| L5 — system quality | ◑ pending | `deploy.yml` runs HTML sanity checks (DOCTYPE / closing-tag / stylesheet) as a lightweight pre-deploy system gate; the planned **Playwright site-build smoke is pending** (Astro adoption, per `tests/TESTING.md`). |
| L6 — E2E / attack & acceptance | ◑ partial | **synthetic compromised-CI attack scenarios ONLINE** (`src/ingest/attack-scenarios.test.ts`); the C3 + arm-symmetry scanner self-checks are adversarial acceptance in CI; **Gherkin acceptance pending**. |
| L7 — acceptance / business gates | ✅ | required CI checks encode the business invariants: C3 aggregate-PASS% lint (+ synthetic self-check), arm-symmetry structural diff (+ self-check), partner-name grep (DR-004 S1Q2), uptime-claims lint, predicate-URI-at-labs scan, coverage, harness verify. |

## Deterministic gates

| Gate | Result |
|---|---|
| Vitest suite | PASS — 437/437 tests, 43 files, ~7s |
| coverage (v8, enforced floor lines 95 / funcs 95 / branch 90 / stmts 95) | PASS — 98.98% lines · 99.26% funcs · 92.32% branch · 98.98% stmts (exit 0) |
| ESLint (typed) | PASS (clean) |
| `tsc --noEmit` | PASS (clean) |
| C3 aggregate-PASS% scanner + self-check | PASS — real scanner (`lint-no-aggregate-pass.ts`), self-check inverts a known-violation fixture |
| arm-symmetry HTML structural diff + self-check | PASS — real scanner (`lint-arm-symmetry.ts`), wired in `deploy.yml` |
| partner-name vendor-generic grep | PASS (0 hits) |
| audit-harness `verify` (hash-pin) | **OK but VACUOUS** — `.harness-hash` is 0 bytes; nothing is pinned, so the gate protects nothing |
| audit-harness `crap` | DEGRADED — reports `pass:true` but `complexity-report` is not installed, so no CRAP score is actually computed |
| audit-harness `bias` | n/a — scans the `tests/` dir (only `TESTING.md`); the colocated `*.test.ts` are never seen by the bias counter |
| audit-harness `arch` | not-configured (0 violations — no `.dependency-cruiser`) |
| markdownlint / Vale / lychee | PASS (Vale advisory) |

## Gaps

**P0:** none.

**P1 (activate the controls `tests/TESTING.md` already advertises):**

- **Empty `.harness-hash` → `harness:verify` is a no-op false-positive.** `TESTING.md`
  states policy files are hash-pinned and that AI edits are "refused at pre-commit,"
  but nothing is pinned and there is no pre-commit hook. Run `pnpm exec audit-harness
  init` to pin the real policy surfaces (the gate scripts, `TESTING.md`, `MARKETING_CLAIMS`
  if present), then the `harness verify` CI step becomes a real tamper gate. Until then
  the gate reports protection it does not provide. (Compensating control: the C3 +
  arm-symmetry self-checks already catch a neutered *scanner* independent of the hash.)
- **No local pre-commit mirror.** All gates run CI-side only; a fast local
  pre-commit (typecheck + lint + test + `harness verify` + `escape-scan --staged`)
  would catch failures before push and is the pattern the sibling repos use. Wire
  it via `.beads/hooks/pre-commit` (bd-managed) or `core.hooksPath`.

**P2 (logged only):**

- L5 Playwright site-build smoke pending (documented — Astro adoption).
- L6 Gherkin acceptance pending (attack-scenario E2E already online).
- CRAP gate degraded: add `complexity-report` as a devDep so the CRAP scorer runs
  instead of silently reporting `pass:true`.
- `bias` gate is mis-targeted at the near-empty `tests/` dir; the real tests are
  colocated `*.test.ts` under `src/` — point the bias/arch config at `src/` or accept
  it as n/a for the colocated layout.
- Stale review-bot references in CI comments (`codeql.yml` cites `.coderabbit.yaml`;
  a `.gemini/` dir remains) predate the Greptile swap — cosmetic doc drift, not a gate.

## Handoff

**Recommended → `/implement-tests`** for the two P1 items (both are activation, not
authoring): (1) `audit-harness init` to make the hash-pin real, and (2) wire a local
pre-commit mirror of the CI gate chain. The L3/L2/L7 substance is already top-tier;
these close the enforcement gap between what `TESTING.md` claims and what actually runs.
