# Changelog

All notable changes to `intent-eval-dashboard` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This repository is **pre-release** (`0.1.0-pre`, no tagged versions yet). Everything
built toward the first `0.1.0` cut is recorded below under `[Unreleased]`.

## [Unreleased]

The public reports dashboard for the Intent Eval Platform at `labs.intentsolutions.io`
— the 6th platform repo. Methodology-first: the eval-set browser ships before any
results browser. Architecture is locked by DR-035 (ISEDC Session 8, ratified
2026-05-29) and the implementation plan tracked under bd epic `bd_000-projects-puxu`.

### Added

- **Repository scaffolding** per DR-035 — README, CLAUDE.md, governance docs, license,
  contributor docs, `tests/TESTING.md` skeleton per the IS Testing SOP, vendored
  `@intentsolutions/audit-harness` dev dependency, and reserved directories `site/`
  (static HTML pages) and `cmd/labs-tui/` (Go TUI deferred to v0.2.0+ pending validated
  demand).
- **v0.1.0 single-file HTML site** (puxu.3) — zero-build static site: Claude-generated
  self-contained HTML per page with one shared `/style.css`. Outsiders can
  `curl` + `view-source` and inspect the entire page. Includes the eval-set browser at
  `/eval-sets/`, anonymous public root, and `/healthz`.
- **VPS deploy workflow** (puxu.3) — GitHub Actions → Tailscale OIDC → force-command SSH
  → rsync of static HTML → `caddy reload` (never restart), per the partner-portals deploy
  pattern in the platform runbook (runbook step 7).
- **Daily-cron eval-set regenerator** (puxu.13) — `scripts/regenerate.py` refreshes the
  eval-set pages on a schedule and commits the result.
- **Evidence Bench j-rig-bench scorecard** (#2) — added the signature-pending Phase A.0
  scorecard (initially not deployed pending signing).
- **Phase A.0 walkthrough + worked example** (#6, #7) — plain-English "what we did + how +
  proof" narrative plus a worked example, the 60-skill list, and an honest scope caveat
  on the Phase A.0 page.
- **Signed Evidence Bench scorecard on the homepage** (#5) — surfaced the signed scorecard
  on the landing page after the Rekor attestation landed.
- **Umbrella back-link** (#8) — link back to the Intent Eval Platform umbrella.
- **Armstrong supervision tree + verify-before-render ingest workers** (puxu.5, #9) — the
  6-worker ingest supervision tree (iec, iel, iah, iaj, iar, ccp) that verifies OIDC
  issuer/subject/`workflow_ref`, Rekor inclusion proof, DSSE signature, and kernel schema
  per row before any render. On failure a worker crashes with a structured reason and the
  supervisor marks `last_known_good_stale_since`.
- **Public results browser** (puxu.6, #10) — renders `gate-result/v1` rows from VERIFIED
  ingest snapshots through the `RenderInput` verify-before-render seam. Ships per-predicate
  counts only, visibility-tier gating (`src/results/visibility.ts`, fail-closed to Tier 2),
  and the **C3 no-aggregate-PASS gate** (`src/results/c3-scan.ts` +
  `scripts/lint-no-aggregate-pass.ts`) wired as a required CI gate that rejects any
  cross-predicate `X/N pass` / `X% pass`.
- **Freshness + decision-mix strip and `/status` USE view** (puxu.7, #11) — top-of-landing
  24-hourly-bucket decision-mix strip plus the `/status` USE-method view of the 6-worker
  ingest pipeline. Absence is shown loudly (`no-data` colored as loudly as `fail`, never
  carried forward), per DR-035 C4.
- **Operator-internal view generator** (puxu.9, #14) — the inverse of the public results
  browser: renders every verified row regardless of tier (no `filterPubliclyVisible`),
  annotates each with WHY it is / isn't public, and emits to `site-internal/` (tailnet-only,
  `noindex`). Reuses the same view-model + render helpers as the public browser.
- **Retraction protocol** (puxu.10, #15) — closed-set `reason_class` denylist
  (`retractions.json`), kernel-validated signed `retraction/v1` Statement (predicate URI at
  `evals.*`, never `labs.*`), a Caddy **410 Gone** snippet generator, and tombstone pages.
  No site rebuild in the takedown path; 4h SLO runbook at
  `000-docs/001-RR-RUNB-retraction-protocol-4h-slo-runbook-2026-06-04.md`.
- **Ops-lite alerting** (puxu.11, #16) — minimal ntfy pager that fires only when a source
  goes silent > 7 days (`SEVEN_DAYS_MS` is the only threshold, fail-closed on clock skew),
  a no-uptime grep-guard (`scripts/check-uptime-claims.ts`) wired as a required CI gate, and
  a best-effort single-operator liveness footer. No PagerDuty, no uptime-SLA claims.
- **Gated teaching-dashboard render lane** (#18) — internal-testing Pillar 1 render lane,
  gated and separate from the public origin.
- **Production `ManifestUrlResolver`** (#19) — wires `iec` to its GitHub Release manifest so
  ingest pulls a real upstream attestation.
- **Live ingest → render pipeline** (#20) — end-to-end verify-before-render pipeline proven
  on `iec`, turning the ingest workers into a working render path.
- **Live ingest-render in the daily cron** (nr75.10, #21) — the daily regenerator now runs
  the live ingest-render pass in addition to the eval-set refresh.
- **Pinned-OIDC-subject confirmations** (nr75.11–nr75.13, #23, #24, #25) — confirmed pinned
  OIDC subjects / tag-ref workflows for `iaj`, `iah` (plus a harness-hash explainer), and
  `iel`.
- **Last-known-good ingest store** (nr75.17, #27) — persists the last-known-good ingest store
  so a partial fetch miss no longer regresses already-rendered rows.
- **HTML structural-diff CI gate for Phase A.0 arm symmetry** (puxu.12, #29) — CI gate that
  structurally diffs the rendered HTML to enforce symmetric Phase A.0 arms.

### Changed

- **Site format: Astro → single-file HTML** for v0.1.0 — replaced the original plan-rank
  Astro choice with Claude-generated self-contained HTML + one shared `/style.css` (zero
  build step; deploy is rsync of `.html` files). Astro is adopted at Phase 2 when interactive
  surfaces arrive (results browser puxu.6 + freshness strip puxu.7). Acting-head decision
  2026-05-30; DR-035 council-ratified bindings unaffected (site generator was a plan-level
  choice, not a council item).
- **Phase A.0 attestation: PENDING → signed** (#3) — flipped the Phase A.0 attestation to
  signed against Rekor index 1689291334.
- **Consume `@intentsolutions/core@0.2.0` from npm** (#12) — switched the kernel dependency
  to the published `0.2.0` npm package and dropped the `file:` bridge.
- **Bump `@intentsolutions/audit-harness`** (#13) — upgraded the vendored harness dev
  dependency from `^0.1.0` to `^1.1.5`.
- **Cron deploy trigger after self-update** (nr75.10, #22) — the regenerator now triggers a
  deploy after its own cron commit so refreshed pages actually ship.

### Fixed

- **Raw Rekor API links on the scorecard** (#4) — switched the scorecard to raw Rekor API
  links because `search.sigstore.dev` deep-links were returning 403 / flaking.
- **Guard the cron against transient manifest-fetch blackouts** (#26) — the regenerator no
  longer regresses rows on a transient upstream manifest-fetch failure.
- **Loud-absence carry-through + iar OIDC tag-ref pin** (#28) — corrected loud-absence
  carry-through behavior and pinned the `iar` OIDC tag-ref.

[Unreleased]: https://github.com/jeremylongshore/intent-eval-dashboard
