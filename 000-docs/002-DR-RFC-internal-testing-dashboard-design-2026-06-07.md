# DR-RFC — Internal testing dashboard (Pillar 1 of the internal ops portal)

| Field | Value |
|---|---|
| Doc | `002-DR-RFC-internal-testing-dashboard-design-2026-06-07.md` |
| Status | Accepted (acting-head, 2026-06-07) |
| Scope | `intent-eval-dashboard` — the gated internal testing dashboard render lane |
| Supersedes | nothing |
| Related | `nr75` reports-hub epic (GH `intent-eval-dashboard#17`); portal epic `internal-ops-portal`; DR-035 (ISEDC Session 8); successor-DR addendum `intent-eval-lab/000-docs/040-AT-DECR-internal-testing-dashboard-basicauth-override-2026-06-07.md` |
| Beads | `nr75.1` render lane · `nr75.2` explainers · `nr75.4` emit · `nr75.6` caddy gate · `nr75.8` Phase-1 milestone |

## 1. Why

Jeremy wants a place he can open in a browser and **actually understand what's going on with our testing and results** — gated, but web-readable from any device. Not raw rows: it must *teach* — what each gate is, how we run it, what the numbers mean, what to fix, and why the result says we're good. This is the operator/learning face of the platform (vs the public marketing face at `labs.intentsolutions.io`).

It is **Pillar 1** of the larger `internal-ops-portal` epic (which later aggregates Plane, Twenty, calendar, and analytics). Pillar 1 is also the first vertical slice of the `nr75` reports-hub epic — so its beads live under `nr75`; the portal epic owns the aggregation + ops pillars + the gate.

## 2. Scope-creep killer — one repo, one new lane

No new repo, no new infra. This is a NEW render lane inside the existing `intent-eval-dashboard`, reusing the existing ingest → verify → render → deploy spine (DR-035). It is a **sibling** of the existing tailnet-only operator-RESULTS view (`src/results/render-internal.ts`, bead puxu.9), not a replacement — that surface is unchanged.

| Surface | Path | Access | Shows |
|---|---|---|---|
| Public results | `site/results/` → `labs.intentsolutions.io/results/` | anonymous | publicly-visible gate-result rows only |
| Operator results (puxu.9) | `site-internal/internal/results/` | **tailnet** (Tailscale identity) | every verified row, tier-annotated |
| **Testing dashboard (this DR)** | `site-internal/internal/testing/` | **basicauth** at `internal.intentsolutions.io` | per-repo testing gates, **taught** |

## 3. The teaching contract (what makes it "for me to read and understand")

Every gate on a repo's page renders as a block with five parts, in order:

1. **Authored explainer** — `content/explainers/<gate>.md`, rendered to safe HTML by a deliberately-minimal Markdown subset (`src/internal-testing/markdown.ts`). *What this is, how we run it, what good looks like.* Written once, reused across every repo. Files shipped: `coverage`, `mutation`, `crap`, `architecture`, `escape-scan`, generic `gate-result` fallback, and `_index` ("how to read this dashboard").
2. **The data** — the verified `gate-result/v1` body: decision, the 4-timestamp surface (evaluated_at · bundle_created_at · Rekor anchor · ingested_at), gate version, predicate URI.
3. **Auto verdict** (`src/internal-testing/verdict.ts`) — a pure, total function mapping the decision to a plain-English reading: `good` / `watch` / `fail` / `error`. **An `error` is never a pass** and is rendered as loudly as a fail; an unknown decision fails closed to `error`.
4. **What we measured** — the `coverage` declaration (dimensions evaluated vs skipped). A skipped dimension is never shown as a passed one.
5. **What to fix** — the row's own `gate_reasons[]`, verbatim. The producing tool already wrote the actionable list; we render it, never invent it.

## 4. Architecture

```text
verified RenderInput (src/ingest/renderer.ts — verify-before-render seam)
   │  buildTestingView + TestingBundleResolver        (richer gate-result/v1 projection)
   ▼
TestingView  (all verified rows; no public-visibility filter — single gated surface)
   │  generateTestingFiles( view, loadExplainers('content/explainers') )
   ▼  joins each row → deriveVerdict + explainerFor
{ path → html } under internal/testing/...
   │  writeTestingSite   (REFUSES site/ ; default site-internal/)
   ▼
site-internal/internal/testing/{index,<repo>}/index.html   (committed; served behind basicauth)
```

Module map (`src/internal-testing/`): `markdown.ts` (minimal MD→HTML), `explainers.ts` (loader + gate-name→explainer matching with aliases + generic fallback), `verdict.ts` (decision→reading), `testing-row.ts` (richer projection + view builder), `render-testing.ts` (HTML), `generate-testing.ts` (file map + safe write), `index.ts` (barrel). CLI: `scripts/generate-internal-testing.ts` (`pnpm run generate:internal-testing`). Wired into `pnpm run check` before `lint:c3:internal`.

### 4.1 Schema note (correction to the original plan)

The plan described the teaching data as `coverage{input_count, decision_count}` + `gate_reasons[]`. The **actual** kernel `gate-result/v1` (`@intentsolutions/core`) carries `coverage{dimensions_evaluated[], dimensions_skipped[]}` (a NOT_APPLICABLE-aware declaration, Blueprint B § 7.4) plus `gate_reasons[]`, `failure_mode`, `advisory_severity`. The render lane uses the real schema: `gate_reasons[]` drives **what to fix**; `coverage` drives **what we measured**. No kernel change required.

## 5. Hard bindings preserved

- **`no-data` is not a pass.** Empty repos render a loud no-data panel, equal visual weight with fail (CMO C4). No carry-forward, no synthetic pass.
- **Verify-before-render.** The lane consumes only the ingest `RenderInput` (verified snapshots); there is no path from a raw manifest into the view. Current honest state: every repo no-data until emit lands upstream.
- **C3 — no cross-predicate aggregate PASS%.** The page renders no `X/N pass` / `X% pass` token; all rows share the `gate-result/v1` predicate URI. `lint:c3:internal` scans the output exactly like the public site (14 files, clean).
- **`site-internal/` separation.** Output never touches `site/`; the CLI refuses a `site` target. The public `deploy.yml` globs `site/**` only.
- **No predicate URIs at `labs.*`.** Predicate URIs are only ever *rendered* (pointed at `evals.*`), never declared at `labs.*`.

## 6. The gate (basicauth) — and its governance cost

The plan locks the gate as **basicauth on a public URL** so it is readable off-tailnet from any device behind a password (the partner-portals pattern; creds in `pass internal-dashboard/basicauth-*`). This **conflicts with DR-035 § 8**, a ratified hard refusal: *"No basicauth on public origin for operator views — operator-internal goes tailnet-only"* (VP DevRel: basicauth-on-public-origin signals "real data behind a paywall," the worst community signal).

Resolution (acting-head decision, 2026-06-07, ISEDC skipped per directive): treat the testing dashboard as a **NEW named gated surface** (`internal.intentsolutions.io`), distinct from the "operator full internal view" the refusal governs, and serve it via basicauth under **CISO's 5 lift-overs** (the same lift-overs DR-035 already attaches to per-named-view basicauth on public origin). The pre-existing tailnet-only operator-results view keeps its tailnet gate. The override is formally recorded in the successor-DR addendum `040-AT-DECR` in `intent-eval-lab/000-docs/`.

Caddy artifact: `deploy/internal-testing.caddy` (handle block + the 5 lift-overs). VPS wiring (rsync `site-internal/internal/testing/`, set basicauth creds, `caddy validate` + `systemctl reload caddy`) is the **human-gated ops step** — NOT in this repo's automation, same posture as the publisher/retraction/ntfy seams.

## 7. Phasing

- **Phase 1 (this DR):** per-repo testing results, taught, gated-web. Prove end-to-end on ONE repo (`intent-eval-core`), then fan out to the other 5.
- **Phase 2:** eval-set results (j-rig + Phase A.0) with the teaching layer.
- **Phase 3:** internal-tool dogfood (CCS → ICOS → INTKB) each as `gate-result/v1`.

## 8. What ships in this PR vs. follow-ups

**This PR (dashboard):** the render lane + explainers + tests (53 new, full coverage) + CLI + `check` wiring + this DR + the Caddy snippet. `pnpm run check` green.

**Follow-ups (sequenced beads):**

- `nr75.4` — emit a signed `report-manifest.json` of `gate-result/v1` rows from `intent-eval-core` CI (the upstream feeder; populates the iec page).
- production `TestingBundleResolver` + ingest wiring (pairs with the emit work).
- `nr75.6` — VPS Caddy basicauth wiring (human-gated) + the `040-AT-DECR` addendum in lab.
- `nr75.8` — the end-to-end Phase-1 milestone (real Rekor entry → ingest → render → off-tailnet load).

## 9. Verification (this PR)

`pnpm run check` green: lint + typecheck + 363 tests (53 new) + coverage (99.3% lines / 93.9% branches, both above the 95/90 floors) + build + all generators + both C3 scans (clean) + uptime guard. The generated `site-internal/internal/testing/` index renders the how-to-read teaching + per-repo summary; per-repo pages render the guided-tour shape (proven populated via fixtures in `render-testing.test.ts`).
