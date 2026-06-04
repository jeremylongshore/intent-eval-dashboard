# CLAUDE.md — intent-eval-dashboard

Guidance for Claude Code when working in `/home/jeremy/000-projects/intent-eval-platform/intent-eval-dashboard/`.

## What this is

The 6th repo of the Intent Eval Platform — the public reports dashboard at `labs.intentsolutions.io`. Renders eval-set methodology + signed Evidence Bundles + gate results from the 5 platform repos. **Methodology-first** — the eval-set browser ships before any results browser.

Created post-ISEDC Session 8 ratification (DR-035 merged 2026-05-29 on intent-eval-lab `main`). Architecture is locked by that DR + the implementation plan at `~/.claude/plans/intent-solutions-lab-reports-amber-lighthouse.md`.

## Canonical sources of truth

| # | Source | Authority |
|---|---|---|
| 1 | bd workspace `~/000-projects/.beads/` | task state under epic `bd_000-projects-puxu` |
| 2 | **DR-035** at `intent-eval-lab/000-docs/035-AT-DECR-...md` | governance bindings; if code and DR conflict, DR wins |
| 3 | DR-010 + DR-028 + DR-034 | prior architectural bindings |
| 4 | Plan file `~/.claude/plans/intent-solutions-lab-reports-amber-lighthouse.md` | implementation sequencing + epic tree |
| 5 | This `CLAUDE.md` | repo-specific working guidance |

## Hard refusal triggers (cannot be silently overridden)

Any change violating these requires formal dissent recording in a successor DR. From DR-035 § 8:

- **No predicate URIs at `labs.*`** — predicate URIs live exclusively at `evals.intentsolutions.io` (CISO binding from DR-010 + DR-035)
- **No aggregate PASS%** across heterogeneous predicates (CTO + CMO + VP DevRel independent refusals)
- **No partner-implicated bundle publication** without written consent (GC refusal)
- **No basicauth on public origin** for operator views — operator-internal goes tailnet-only (VP DevRel refusal)
- **No asymmetric Phase A.0 dashboard render** — symmetric arms or blog-only fallback (VP DevRel + CTO refusals)
- **No GCP object storage** — content-address into local Contabo disk → Backblaze B2 at 12-month/100GB trigger (CISO refusal, GCP exodus binding)
- **No production-system SLO with paging** beyond CISO's 7-day-silence threshold (CFO refusal)
- **No render-from-manifest without re-verification** — pinned OIDC subject + `workflow_ref:` + Rekor inclusion proof at ingest (CTO + CISO independent refusals)

Full catalog: DR-035 § 8.

## Anti-corruption layer

`@intentsolutions/core` is the canonical contracts kernel. This repo consumes it as a published kernel consumer — exactly like any external integrator would. **Do not vendor types, schemas, or validators in this repo** — always import from `@intentsolutions/core`. Demonstrates the eat-our-own-ecosystem principle (Blueprint A § 1.2 principle 10).

## Tech stack (v0.1.0)

- **Site format:** Single-file HTML per page, Claude-generated self-contained HTML with one shared `/style.css`. Zero build step; deploy is rsync of `.html` files. Plays to Claude's documented single-file HTML strength. Outsiders can `curl` + `view-source` and get the entire page inspectable (Gregg + CISO "no JS framework hidden complexity" framing). Acting-head decision 2026-05-30.
- **Astro adopted at Phase 2** when interactive surfaces arrive (results browser puxu.6 + freshness strip puxu.7)
- **Package manager:** pnpm (for `@intentsolutions/audit-harness` dev dep only at v0.1.0; no Astro deps yet)
- **Node:** 20+ LTS (for harness; not required to serve HTML)
- **Deploy:** GitHub Actions → Tailscale OIDC → force-command SSH → rsync of static HTML → Caddy reload (NOT restart). NO build step at v0.1.0
- **VPS:** Contabo `intentsolutions` (167.86.106.29), Caddy block `labs.intentsolutions.io`
- **DNS:** Porkbun A + CAA (LE-only) + DNSSEC (zone-level inherited)
- **TUI (v0.2.0+ reservation):** Go, `cmd/labs-tui/` — NOT implemented at v0.1.0; directory + module path reserved per A3 ratified deferral

## What ships at v0.1.0 (Phase 1)

- Eval-set browser at `/eval-sets/` — versioned, lineage-tracked spec rendering
- Public anonymous root with CMO substance constraint (eval-set browser + freshness-strip stub + methodology docs link + end-to-end signed example)
- `/healthz` endpoint
- **No `gate-result/v1` row rendering** — predicate-bearing rows are Phase 2 work
- **No predicate URIs declared at `labs.*`** — methodology + spec rendering only

## What ships in Phase 2

Schema evolution to `@intentsolutions/core@0.2.0` · 6-worker ingest supervision tree (iec, iel, iah, iaj, iar, ccp — ICOS struck per cross-tier policy) · results browser · per-row visibility-tier gating · sign-your-own-homework (sequenced) · retraction protocol + Caddy kill-switch · ops-lite (ntfy + /status + 7d pager) · Phase A.0 symmetric rendering

Phase 2 triggers when `D28-PHASE-A0` returns.

## Default visibility (DR-035 C2 — CSO hybrid)

| Source tier | Default | Override |
|---|---|---|
| Tier 1 — IS-internal | Eventually-public with disclosed embargo | `embargo_until:<date>` tag |
| Tier 2 — partner-implicated | Internal-default + affirmative written consent | Per-partner consent clause |
| Tier 3 — third-party non-contract | Case-by-case | GC review per artifact |

## Default ingest contract (DR-035 B1)

Every per-repo ingest worker MUST verify before rendering:
1. OIDC issuer + subject + `workflow_ref:` claim against pinned per-repo allowlist
2. Rekor inclusion proof, row-by-row
3. DSSE signature, row-by-row
4. Schema validation against `@intentsolutions/core` (kernel-pinned version)

On failure → ingest worker crashes with structured reason; supervisor marks `last_known_good_stale_since=<ts>`; renderer uses prior snapshot + visible `stale_since` badge.

## Tests + harness

`@intentsolutions/audit-harness` vendored as dev dep per IS Testing SOP. Run `pnpm exec audit-harness verify` for hash-pinned policy verification before commits.

`tests/TESTING.md` is the per-repo testing-policy doc. CI references in-repo harness commands — never `~/.claude/` paths.

## Results browser (`/results/`, puxu.6 — built)

The public results browser renders `gate-result/v1` rows from the VERIFIED ingest snapshots. It consumes `src/ingest/renderer.ts`'s `RenderInput` (the verify-before-render seam) — never raw manifests — resolves content-addressed bundles to gate-result rows, applies the public visibility-tier gate, and emits self-contained HTML under `site/results/` (same static pattern as `scripts/regenerate.py`; served directly by Caddy, no Hugo project in this repo).

| Piece | Location | Role |
|---|---|---|
| Visibility-tier gate | `src/results/visibility.ts` | Pure public-render rule (DR-035 C2). Tier-2-no-consent / Tier-3 / Tier-1-under-embargo → ABSENT from public output. Fail-closed default = Tier 2. |
| View-model + resolver seam | `src/results/row-model.ts` + `bundle-resolver.ts` | `RenderInput` → `ResultsRow`s with the 4-timestamp surface (evaluated_at + bundle created_at + Rekor anchor + ingested_at). Production resolver re-validates each bundle against the kernel EvidenceBundle schema. |
| HTML render | `src/results/render-html.ts` | Index + per-repo + per-bundle deep-link pages. no-data == fail visual weight (CMO C4). stale_since badge. as-of = min(ingested_at). Per-predicate counts ONLY. |
| Generator | `src/results/generate.ts` + `scripts/generate-results.ts` | `pnpm run generate:results`. Current state = all repos no-data (emit-evidence incomplete upstream). |
| **C3 gate** | `src/results/c3-scan.ts` + `scripts/lint-no-aggregate-pass.ts` | `pnpm run lint:c3`. Cross-predicate-aware scanner: any `X/N pass` / `X% pass` spanning ≥2 predicate URIs → exit 1. Single-predicate counts allowed. Wired into `ingest-ci.yml` + `deploy.yml` as a REQUIRED gate (run directly, never piped through `tee` — exit code is load-bearing). Synthetic fixtures at `src/results/__fixtures__/c3-{clean,violation}.html`. |

**C3 is the hard integrity binding** (CTO + CMO + VP DevRel triple-refusal). Never weaken the scanner or the gate to make a test pass. The tailnet-internal operator view (puxu.9) is a SEPARATE surface that reuses the same view-model but skips `filterPubliclyVisible` — it is BUILT (see § "Operator-internal view" below) and emits to `site-internal/`, never `site/`.

## Freshness + decision-mix strip + `/status` (puxu.7 — built)

The top-of-landing strip (one row per source repo × 24 hourly buckets, colored by decision mix) and the `/status` USE-method view of the ingest pipeline. Mandatory per DR-035 C4 (Gregg "if absent, the dashboard is useless"). The load-bearing binding: **absence is shown loudly, never silently filled** — an hour with no verified data is `no-data`, colored as loudly as `fail`, and is NEVER carried forward, inferred, blanked, or treated as a pass.

| Piece | Location | Role |
|---|---|---|
| Bucket model | `src/freshness/bucket-model.ts` | Pure 24-bucket decision-mix. A bucket's `kind` is `no-data` IFF its row count is 0 — there is NO carry-forward code path. Severity coloring fail > error > advisory > pass (a fail never masked by a pass). Fail-closed on an unparseable clock (everything → no-data). |
| USE model | `src/freshness/use-model.ts` | USE-method observability of the 6-worker ingest pipeline itself. U = fresh workers / 6 (stale ≠ utilized); S = restart pressure vs OTP budget (escalation = max saturation); E = crash/verification-failure count with structured reasons. Plus fully-silent-repos from the 24h strip. |
| HTML render | `src/freshness/render-strip.ts` | Strip fragment (injected into landing) + the `/status` page. `no-data` reuses the loud `bucket--no-data` class (== `fail`). Color-blind-safe glyphs + `sr-only` text. No predicate-URI dimension at all → structurally C3-clean. |
| Generator | `src/freshness/generate.ts` + `scripts/generate-status.ts` | `pnpm run generate:status`. Injects the strip into `site/index.html` between `<!-- FRESHNESS-STRIP:START/END -->` markers (idempotent; THROWS if markers absent — never silently appends), writes `site/status/index.html`. Current state = all 6 repos no-data, U=0/6 (honest current truth). |

The synthetic **25h-silent worker test** (`src/freshness/bucket-model.test.ts` + `generate.test.ts`) proves the binding: a worker whose last verified row was 25h ago shows `no-data` across the whole window with the prior pass NOT back-filled into any in-window bucket. `pnpm run check` runs `generate:status` then `lint:c3` over the whole `site` so the strip + status output are C3-gated. The internal index reuses this USE-method view (see § "Operator-internal view" below).

## Operator-internal view (`site-internal/`, puxu.9 — built)

The **inverse of the public results browser.** The public `/results/` generator applies `filterPubliclyVisible`, so Tier-2-no-consent / Tier-3 / Tier-1-under-embargo rows are ABSENT. The operator-internal generator renders **every** verified row regardless of tier, for operators on the tailnet, and annotates each row with WHY it is / isn't public — reusing the SAME `row-model.ts` view-model + `render-html.ts` helpers + `freshness` USE-method view, so the operator view is a faithful superset, not a divergent fork.

| Piece | Location | Role |
|---|---|---|
| Internal HTML render | `src/results/render-internal.ts` | Reuses public `esc`/`decisionBadge`/`asOfBanner`/`perPredicateBreakdown`/`noDataPanel` + `SITE_FOOTER`; adds a leading **Visibility** column (`visibilityBadge` computes the tier + public/internal-only reason via the SAME `decidePublicVisibility` rule). `noindex, nofollow`, no public canonical, `iep-surface=tailnet-only`. Embeds the USE-method cards (`renderUseCards`, extracted from `render-strip.ts`) on the index. |
| Internal generator | `src/results/generate-internal.ts` | `buildInternalResultsView` = `buildResultsView` with **NO** `filterPubliclyVisible`. `generateInternalFiles` emits `internal/results/{index,<repo>,<repo>/<bundle>}/index.html`. `buildInternalUse` derives an honest USE view (fresh = has rows AND not stale). |
| CLI entrypoint | `scripts/generate-internal.ts` | `pnpm run generate:internal` → writes `site-internal/`. **Refuses** to write into the public `site/` origin (exits non-zero). |
| C3 gate (internal) | `scripts/lint-no-aggregate-pass.ts site-internal` | `pnpm run lint:c3:internal`. Same scanner; the internal output stays per-predicate-counts-only — no cross-predicate aggregate PASS%, even internally. |

**Strict separation (load-bearing):** internal output goes to `site-internal/` — NEVER `site/`. The public Caddy block serves `site/` only; the public `deploy.yml` triggers on `paths: ['site/**']` and its smoke/C3/predicate scans all target `site` — so `site-internal/` is never wired into the public origin. The generated HTML IS committed (so the VPS `git reset --hard` checkout has it for the future tailnet block); only `site-internal/dist|.astro` are gitignored, mirroring `site/`. **The inverse-of-public test** (`generate-internal.test.ts`) proves it: a mixed-tier fixture (Tier-2-no-consent + embargoed Tier-1 + Tier-3 + public) → the public generator omits the three non-public bundles; the internal generator includes all four (keys + deep-link pages present).

**Deploy is a human-gated follow-up — NOT in this repo's automation.** The tailnet-only hostname, the Tailscale-identity-gated Caddy block serving `site-internal/`, and DNS/port wiring are a manual VPS ops step. Per VP DevRel binding (DR-035 § 8): **no basicauth on the operator hostname — Tailscale identity is the gate.** Matches existing tailnet-only infra (Netdata `intentsolutions:19999`, ntfy `intentsolutions:8080`). Until that step is done there is no route to `site-internal/`. Do NOT touch the VPS/Caddy/Tailscale to wire it without explicit human go-ahead.

## Tactical guidance

- **Partner-name discipline (DR-004 S1Q2):** enforced via CI grep gate. The grep pattern lives in PRIVATE `~/000-projects/CLAUDE.md`; never inline in any file in this repo.
- **Caddy reload on VPS:** `caddy validate` first, then `systemctl reload caddy` (NEVER `restart`). 24 prod containers depend on the VPS.
- **DNS:** Porkbun creds at `~/000-projects/braves/.env.sops` → `PORKBUN_API_KEY` + `PORKBUN_SECRET_KEY` (use `scripts/sops-env` wrapper). DO NOT prompt user for DNS — automate.
- **Bd workflow:** every change tied to a `puxu.N` bead. Update status → work → close with evidence. JSONL throttle mitigation in place via `export.interval=1s` at umbrella workspace.
- **Doc filing:** IS Standard v4.3 — `NNN-CC-ABCD-<title>-<date>.md` under `000-docs/`.
