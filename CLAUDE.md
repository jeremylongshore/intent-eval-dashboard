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

## The v0.1.0 baseline (Phase 1)

- Eval-set browser at `/eval-sets/` — versioned, lineage-tracked spec rendering
- Public anonymous root with CMO substance constraint (eval-set browser + freshness strip + methodology docs link + end-to-end signed example)
- `/healthz` endpoint
- **No predicate URIs declared at `labs.*`** — predicate URIs are only ever rendered (pointed at `evals.*`), never declared here

## Built on top of the baseline (shipped)

The dashboard now consumes `@intentsolutions/core@^0.9.0` (bumped from `^0.2.0` for the wave-2 `UsageEvent` + `HumanReview` entities) and the following are **built and committed** — see the per-feature sections below for the module maps:

- 6-worker verify-before-render ingest supervision tree (iec, iel, iah, iaj, iar, ccp — ICOS struck per cross-tier policy) + live ingest→render pipeline in the daily cron
- Results browser with per-row visibility-tier gating (puxu.6)
- Per-skill adoption + human-trust signals surface, C3-safe per-dimension (`/skills/`, ig4h.6 — wave-2)
- Freshness + decision-mix strip + `/status` USE-method view (puxu.7)
- Operator-internal view (puxu.9), retraction protocol + Caddy 410 kill-switch (puxu.10), ops-lite ntfy alerting (puxu.11)
- Phase A.0 symmetric-render HTML structural-diff gate (puxu.12)

Still genuinely deferred: the Astro migration (the site remains single-file HTML), the `cmd/labs-tui/` Go TUI (v0.2.0+ reservation, validated-demand-gated), and the tailnet/basicauth VPS deploy wiring for the operator-internal surfaces (documented human-gated ops step).

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

**Full pre-commit gate chain:** `pnpm run check` runs `format:check` → `lint` → `typecheck` → `test` → `build` → all generators (`generate:results` + `generate:skills` + `generate:status` + `generate:internal` + `generate:internal-testing` + `generate:retractions`) → `lint:c3` + `lint:c3:internal` + `lint:uptime` + `lint:arm-symmetry`. Run it before every commit.

- `pnpm run lint:arm-symmetry` — symmetric-render structural-diff gate over `site/eval-sets/j-rig-bench` (`scripts/lint-arm-symmetry.ts`, backed by `src/results/arm-symmetry-scan.ts`; enforces the "no asymmetric Phase A.0 render" hard refusal). REQUIRED in `deploy.yml` (run directly, plus a self-check against the synthetic asymmetric fixture).
- `pnpm run generate:internal-testing` — the internal teaching-dashboard lane (§ above).

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

## Per-skill signals (`/skills/`, ig4h.6 — wave-2, built)

The public per-skill surface renders the wave-2 adoption + human-trust + authoring-quality signals **per skill, per dimension, side by side — never rolled.** It is a SIBLING of `src/results/` (mirrors the same verify-before-render seam), not a parallel ingest path. It consumes the new `@intentsolutions/core@^0.9.0` entities (`UsageEvent` — the 15th kernel entity — and `HumanReview`) through a clean `SkillSignalResolver` seam. The adoption-score values are produced upstream by j-rig (`UsageEvent` ingest + the `HumanReview` capture verb, DR-103 Items 1/2/4/5, built in parallel); this repo is a **pure consumer**.

| Piece | Location | Role |
|---|---|---|
| View-model + resolver seam | `src/skills/skill-signal-model.ts` | `SkillSignalResolver` → `SkillCard`s. Three INDEPENDENT dimensions (`AdoptionSignal`, `HumanTrustSignal`, `QualitySignal`), each with its own provenance + predicate URI. Adoption = raw per-`(meter, unit)` verified counts (never cross-`(meter,unit)` summed). Human-trust = orthogonal thumbs / score_text / annotation channels (never folded). Quality = link-out to the validate-skillmd rubric (no scalar stored). |
| HTML render | `src/skills/render-skills.ts` | THREE separate single-dimension renderers (`renderAdoptionPanel` / `renderHumanTrustPanel` / `renderQualityPanel`) — **none takes more than one dimension; there is deliberately no `renderRolledScore`.** Reuses `esc`/`slug`/`SITE_HEADER`/`SITE_FOOTER`/`noDataPanel` from `render-html.ts`. no-data renders LOUD (`badge--no-data` == fail weight). No renderer arithmetic (counts printed verbatim, never divided). |
| Generator | `src/skills/generate-skills.ts` + `scripts/generate-skills.ts` | `pnpm run generate:skills`. Emits `site/skills/index.html` + `site/skills/<skill>/index.html`. Current state = all tracked skills no-data (upstream signals not wired yet) — rendered loud, never blanked. |
| Fixtures | `src/skills/__fixtures__/skills-fixtures.ts` | KERNEL-VALIDATED `UsageEvent` / `HumanReview` builders (parse against the real `@intentsolutions/core` schemas) + map-backed fixture resolver. |
| C3 gate | reuses `src/results/c3-scan.ts` via `pnpm run lint:c3` over `site/` | The same cross-predicate scanner walks `site/skills/` automatically. The PRIMARY C3 defence is STRUCTURAL: `SkillCard` has no aggregate field and no renderer combines two dimensions — verifiable by reading the types. The scanner is belt-and-suspenders. |

**C3-SAFE BY CONSTRUCTION (DR-035 C3 + DR-103 C3 — HARD refusal):** there is **no representable cross-dimension or cross-predicate rollup** on this surface. No `rolledScore` / `overallScore` / `passPct` field exists on `SkillCard`; no exported function combines two dimensions (a test asserts no `roll`/`aggregate`/`overall`/`composite` symbol is exported). Each dimension is a different measurement against a different predicate URI and is rendered independently. Predicate URIs are only ever RENDERED (pointed at `evals.*`), never declared at `labs.*` (CISO binding). **This surface ships ZERO kernel artifacts — it is a pure consumer; the Evidence-Bundle-compat obligation is the sibling kernel beads' (DR-103 Items 1/2).** Until the upstream `UsageEvent`/`HumanReview` ingest lands, the production resolver cannot wire — the surface ships fed by the in-memory fixture resolver with an honest loud no-data state.

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

## Internal testing dashboard (`site-internal/internal/testing/`, nr75 — built)

The **gated teaching dashboard** — Pillar 1 of the internal ops portal (`002-DR-RFC-internal-testing-dashboard-design-2026-06-07.md`). A SECOND internal render lane (sibling of the operator-RESULTS view, not a replacement) that renders testing/gate results to *teach*: what each gate is, how it runs, what the numbers mean. Lives in `src/internal-testing/` (verdict + explainers + markdown + row model + resolver + render).

| Piece | Location | Role |
|---|---|---|
| Verdict + explainers | `src/internal-testing/{verdict,explainers}.ts` | Per-gate teaching copy + pass/fail verdict logic. `explainers.ts` renders authored prose via `markdown.ts` (`renderMarkdown`). |
| Row model + resolver | `src/internal-testing/{testing-row,store-testing-resolver}.ts` | Consumes the same verified ingest store as the other lanes. |
| HTML render | `src/internal-testing/render-testing.ts` | Teaching-oriented render (markdown → HTML via `markdown.ts`). |
| Generator + CLI | `src/internal-testing/generate-testing.ts` + `scripts/generate-internal-testing.ts` | `pnpm run generate:internal-testing`. Emits to `site-internal/internal/testing/` — **REFUSES to write into `site/`** (exits non-zero). |

**Deploy is a human-gated follow-up** (basicauth-gated per DR-040 override; `deploy/internal-testing.caddy` + runbook). Not in this repo's automation — same posture as the other internal surfaces. Do NOT wire the VPS/Caddy without explicit go-ahead.

## Retraction protocol (`src/retraction/`, puxu.10 — built)

The **INTEGRITY capability to take down a published attestation honestly.** Sigstore/Rekor entries are append-only and **cannot be un-logged** — so we do not pretend a retracted result never existed. We record an append-only signed `retraction/v1` record, return **410 Gone** at the deep URL (not 404 — that would lie), and serve a tombstone disclosing the `reason_class`. **No site rebuild** in this path (`git commit + rsync + caddy reload`).

| Piece | Location | Role |
|---|---|---|
| Denylist + validator | `src/retraction/denylist.ts` + `retractions.json` | `retractions.json` format. Validator REJECTS open-text `reason_class` (enum sourced FROM the kernel), subject-less entries, unsafe `deep_url_path`, unknown fields (strict). Empty `[]` is a valid no-op state. |
| Signed Statement | `src/retraction/statement.ts` | Builds + **kernel-validates** the `retraction/v1` in-toto Statement against `@intentsolutions/core`'s `RetractionV1Schema`. Predicate URI = kernel `RETRACTION_V1_URI` (`evals.intentsolutions.io/retraction/v1`, NEVER `labs.*`). Signing behind `RetractionSigner` seam (sigstore keyless CI); default `unsignedSigner` returns canonical payload `signed: false` — never a faked signature. |
| Caddy 410 generator | `src/retraction/snippet.ts` → `deploy/retractions.snippet` | One `handle` block per deep URL → `file_server { status 410 }` serving the tombstone body. `{$IEP_SITE_ROOT}` env-parameterized. Empty denylist → no-op snippet. |
| Tombstone generator | `src/retraction/tombstone.ts` → `site/retracted/<slug>/index.html` | Append-only-honesty disclosure page; reuses public HTML chrome; `noindex`; structurally C3-clean (no predicate counts). |
| Orchestrator + CLI | `src/retraction/generate.ts` + `scripts/generate-retractions.ts` | `pnpm run generate:retractions`. Loads + validates `retractions.json` (FAILS CLOSED on any invalid entry — never partial), regenerates snippet + tombstones. |
| 4h SLO runbook | `000-docs/001-RR-RUNB-retraction-protocol-4h-slo-runbook-2026-06-04.md` | Operator flow: request → add entry → regenerate → commit → rsync + `caddy validate` + `systemctl reload caddy` (NEVER restart) → 410 in < 4h, no rebuild. |

**Three hard bindings, enforced in code + test:** (1) **closed-set `reason_class`** — `denylist.test.ts` proves `because-i-said-so` is rejected, the enum is sourced from the kernel so it can't drift; (2) **predicate URI at `evals.*` never `labs.*`** — `statement.test.ts` asserts `new URL(uri).host === 'evals.intentsolutions.io'`; (3) **no Hugo / no rebuild** — flat-file generators, retraction takes effect via rsync + caddy reload. The synthetic end-to-end test (`generate.test.ts`) proves add-entry → regenerate → snippet has the 410 + tombstone exists on disk (the real "<4h deep URL 410" is the human-gated VPS step). **Deploy is NOT in this repo's automation** — rsync of `deploy/retractions.snippet` to `/etc/caddy/`, `caddy validate`, `systemctl reload caddy` are the documented manual VPS step; do NOT touch the VPS.

## Ops-lite alerting (`src/alerting/`, puxu.11 — built)

The **minimal alerting layer.** Deliberately tiny: the only thing worth waking a single operator for is a source going DARK. Reuses the SAME ingest-snapshot/liveness data the freshness USE + bucket models consume (puxu.7) — the alert evaluator does not reinvent liveness.

| Piece | Location | Role |
|---|---|---|
| Alert evaluator | `src/alerting/evaluate.ts` | Pure function. Given per-source `lastSuccessfulIngestIso` + an INJECTED `now`, emits a critical alert for every source silent > 7 days. `SEVEN_DAYS_MS` is the ONLY threshold. Never reads the clock (`now` is a parameter). Fail-closed: unparseable last-ingest → `Infinity` silence (pages); future-dated (skew) → clamps to 0 (no page); unparseable `now` → epoch-0 anchor (never pages a real-dated source off a garbage clock). |
| ntfy formatter + transport seam | `src/alerting/ntfy.ts` | `formatCriticalMessage` builds the ntfy payload: priority `5`, topic `prod-alerts` (Note: code still targets `prod-alerts`; the VPS renamed `prod-alerts`→`prod-health` — reconciled via the injected topic on the VPS cron, not in-repo.), names each silent source + days-silent, links to the PUBLIC `/status`. THROWS on an empty critical list (never page on nothing). Push behind the injectable `NtfyTransport`; default `NoopNtfyTransport` logs what it WOULD push and returns `delivered: false` — NEVER fakes a send, NEVER hardcodes the VPS address (base URL via `IEP_NTFY_BASE_URL`, documented `http://ntfy.invalid` placeholder). |
| Pass orchestrator | `src/alerting/run.ts` | `runAlertPass(liveness, now, transport)` = evaluate → (only if any silent>7d) format + push. Can never page on an empty list by construction. |
| No-uptime grep-guard | `src/alerting/no-uptime-scan.ts` + `scripts/check-uptime-claims.ts` | `pnpm run lint:uptime`. Self-contained detector (mirrors `c3-scan.ts`) that fails if any uptime-SLA claim (`99.9% uptime`, uptime/availability guarantee, `uptime SLA`, `N nines`) appears in `site/`. Neutral "liveness"/"status" prose + the exact best-effort commitment are NOT flagged. Wired into `deploy.yml` as a REQUIRED gate + a self-check (the synthetic `__fixtures__/uptime-violation.html` MUST fail the scanner). |
| Liveness-check CLI | `scripts/check-liveness-alerts.ts` | `pnpm run check:liveness`. What a VPS cron would run: load current liveness → `runAlertPass` → push via the (default no-op) transport. Current honest state = all 6 sources never-seen → would page, but the no-op transport delivers nothing and says so. |

**Four hard bindings (CFO + CISO refusals, DR-035 § 8), enforced in code + test:**

1. **7-day-silence is the ONLY paging trigger** (CISO). `evaluate.test.ts` proves the boundary (exactly 7d → no page; 7d+1ms → page; 6d → no page) AND the only-trigger property (a source erroring its head off with a fresh ingest does NOT page). No latency/error-rate/threshold pagers exist.
2. **ntfy only, NO PagerDuty** (CFO). The only push protocol is ntfy (`prod-alerts`), behind the `NtfyTransport` seam. No PagerDuty/Opsgenie/Slack/SMS client anywhere.
3. **No misleading uptime claims** (CFO). The `lint:uptime` grep-guard fails on any uptime-SLA claim in `site/`. The public commitment is exactly **"best-effort, single-operator, see /status for liveness"** — baked into the shared `SITE_FOOTER` (`render-html.ts`) + the `/status` footer (`render-strip.ts`) + the hand-maintained `site/index.html` footer.
4. **`/status` stays public, no-auth.** The ntfy body links to `https://labs.intentsolutions.io/status/`; the page itself remains anonymous (DR-035 C4).

**Human-gated VPS seam (NOT in this repo's automation):** the REAL ntfy push (HTTP POST to the tailnet ntfy `http://intentsolutions:8080`) and the cron that runs `check:liveness` live on the VPS, where a real `NtfyTransport` is injected via `IEP_NTFY_BASE_URL`. Do NOT touch the VPS / ntfy server / cron / Caddy to wire it without explicit human go-ahead — same posture as the publisher rsync seam and the retraction Caddy reload.

## AI code review (Greptile + Gemini)

Two AI reviewers run on PRs here, **both advisory** — neither is a branch-protection
required check. The deterministic merge gate is this repo's own CI (the C3 no-aggregate-PASS gate + lint:uptime + audit-harness verify + ingest/deploy gates) plus CodeQL.

- **Gemini Code Assist** (`.gemini/config.yaml` + `.gemini/styleguide.md`) is the
  **active** reviewer. Re-instated 2026-06-24 as the fallback after the Greptile
  review quota was exhausted. Workhorse for design / logic / correctness /
  cross-artifact consistency; CodeQL owns security.
- **Greptile** (`.greptile/config.json` + `rules.md` + `files.json`) is configured to
  the platform-unified schema (`strictness: 3`, `commentTypes: ["logic","syntax"]`,
  `statusCheck: false`, a universal `no-gate-weakening` rule, plus this repo's scoped
  invariant rules). It stays in place and resumes when the Greptile quota resets.

Read either review when present; the required gate is CI. Re-installing/uninstalling
the GitHub Apps is an admin (UI) action — the in-repo config here does not install them.

## Tactical guidance

- **Partner-name discipline (DR-004 S1Q2):** enforced via CI grep gate. The grep pattern lives in PRIVATE `~/000-projects/CLAUDE.md`; never inline in any file in this repo.
- **Caddy reload on VPS:** `caddy validate` first, then `systemctl reload caddy` (NEVER `restart`). 24 prod containers depend on the VPS.
- **DNS:** Porkbun creds at `~/000-projects/braves/.env.sops` → `PORKBUN_API_KEY` + `PORKBUN_SECRET_KEY` (use `scripts/sops-env` wrapper). DO NOT prompt user for DNS — automate.
- **Bd workflow:** every change tied to a `puxu.N` bead. Update status → work → close with evidence. JSONL throttle mitigation in place via `export.interval=1s` at umbrella workspace.
- **Doc filing:** IS Standard v4.3 — `NNN-CC-ABCD-<title>-<date>.md` under `000-docs/`.
