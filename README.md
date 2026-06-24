# intent-eval-dashboard

Part of the **[Intent Eval Platform](https://github.com/intent-solutions-io/intent-eval-platform)** — the umbrella mapping the six repos that converge via a shared Evidence Bundle schema.

> Public reports dashboard for the Intent Eval Platform. Live at [labs.intentsolutions.io](https://labs.intentsolutions.io).

The 6th member of the Intent Eval Platform. Renders eval-set methodology + signed Evidence Bundles + gate results from the 5 platform repos and selected external consumers. Methodology-first surface — the eval-set browser ships before any results browser.

## Where this fits

| Repo | Role |
|---|---|
| [`intent-eval-core`](https://github.com/jeremylongshore/intent-eval-core) | Canonical contracts kernel — types, schemas, validators |
| [`intent-eval-lab`](https://github.com/jeremylongshore/intent-eval-lab) | Methodology + Decision Records + Blueprints (constitution) |
| [`intent-audit-harness`](https://github.com/jeremylongshore/intent-audit-harness) | Deterministic gates + emit-evidence |
| [`j-rig-skill-binary-eval`](https://github.com/jeremylongshore/j-rig-skill-binary-eval) | Behavioral eval + provider adapters |
| [`intent-rollout-gate`](https://github.com/jeremylongshore/intent-rollout-gate) | GitHub Action consuming Evidence Bundles for ship/no-ship decisions |
| **`intent-eval-dashboard`** | **Renders the above for public + tailnet-internal audiences** |

## Status

**Built and live at [labs.intentsolutions.io](https://labs.intentsolutions.io).** The eval-set browser, results browser (`gate-result/v1` rows from verified ingest snapshots), freshness + decision-mix strip, `/status` USE-method view, operator-internal view, retraction protocol, and ops-lite alerting are all shipped (beads puxu.6/.7/.9/.10/.11). The 6-worker verify-before-render ingest tree and the live ingest→render pipeline are running in the daily cron. Tracking at [issue #1](https://github.com/jeremylongshore/intent-eval-dashboard/issues/1) (umbrella).

Ratified by ISEDC Session 8 — see [DR-035](https://github.com/jeremylongshore/intent-eval-lab/blob/main/000-docs/035-AT-DECR-isedc-council-session-8-labs-dashboard-2026-05-29.md) on the lab repo.

## What's here at v0.1.0

- **Eval-set browser** at `labs.intentsolutions.io/eval-sets/` — versioned, lineage-tracked spec rendering
- **Public anonymous root** — methodology docs, freshness strip (stub at v0.1.0), end-to-end signed example
- **Operator-internal view** — separate tailnet-only hostname, Tailscale identity, all reports regardless of public visibility tags

**Site format:** single-file HTML per page at v0.1.0 (zero build step; pure rsync deploy). Astro adopted at Phase 2 when interactive surfaces arrive. Acting-head decision 2026-05-30 — see plan file for reasoning.

## Operator-internal view (tailnet-only) — `site-internal/`

The public results browser at `/results/` renders **only publicly-visible rows** — it applies the visibility-tier filter, so Tier-2-no-consent, Tier-3, and Tier-1-under-embargo rows are absent. The **operator-internal view is the inverse**: it renders **every** verified row regardless of visibility tier, for operators on the tailnet, and annotates each row with its tier so an operator can see *why* a row is or isn't public.

| Concern | Public browser | Operator-internal view |
|---|---|---|
| Generator | `src/results/generate.ts` + `scripts/generate-results.ts` | `src/results/generate-internal.ts` + `scripts/generate-internal.ts` |
| Visibility filter | applies `filterPubliclyVisible` | **skips it** — all tiers render |
| Per-row tier annotation | n/a | `tier N — public` / `… — internal-only` badge per row |
| View-model / 4-timestamp surface | `row-model.ts` | **same** `row-model.ts` |
| HTML helpers | `render-html.ts` | reuses `render-html.ts` + adds a Visibility column (`render-internal.ts`) |
| USE-method view | `/status` | embedded on the internal index (reuses `freshness/render-strip.ts`) |
| Output directory | `site/` | **`site-internal/`** (never `site/`) |
| C3 no-aggregate-PASS% gate | enforced | **also enforced** (per-predicate counts only) |

Generate it with:

```bash
pnpm run generate:internal      # writes site-internal/internal/results/*
pnpm run lint:c3:internal       # C3 gate over the internal output
```

(Both are wired into `pnpm run check`.)

### Strict `site/` vs `site-internal/` separation — the load-bearing binding

`site-internal/` is **tailnet-only and must never be served from the public origin.** The separation is enforced structurally:

- The public Caddy block serves `/srv/intent-eval-dashboard/site/` only.
- The public `deploy.yml` triggers on `paths: ['site/**']` (a change to `site-internal/**` does **not** redeploy the public site), and its smoke-file checks, C3 scan, and predicate-URI scan all target `site` only.
- `generate-internal.ts` **refuses** to write into `site/` (exits non-zero if the target basename is `site`).
- The internal pages are `noindex, nofollow` with no public `canonical`, and self-identify via `<meta name="iep-surface" content="tailnet-only">`.

`site-internal/`'s generated HTML *is* committed (so the VPS `git reset --hard` checkout has it on disk for the future tailnet block); only build artifacts under it are gitignored, mirroring `site/`.

### Deploy is a documented human-gated follow-up (NOT in this change)

The tailnet-only **hostname** (e.g. `labs-internal.<tailnet>`), the **Tailscale-identity-gated Caddy block** that serves `site-internal/`, and the DNS/port wiring are a **human-gated VPS ops step** — they are intentionally **not** implemented here. This change builds the generator + its output only. Per the puxu.9 bead and the VP DevRel binding (DR-035 § 8): **no basicauth on this hostname — Tailscale identity is the gate.** It matches the existing tailnet-only infra pattern (Netdata at `intentsolutions:19999`, ntfy at `intentsolutions:8080`). Until that ops step is done, there is **no route** to this output.

## Beyond the v0.1.0 baseline (shipped)

The dashboard now consumes `@intentsolutions/core@0.2.0` (`pre_registration_hash`, `retraction/v1`, `dashboard-render/v1`) and the following are **built and committed** on top of the original v0.1.0 methodology-first cut: the 6-worker verify-before-render ingest supervision tree, the results browser, the retraction protocol with its Caddy 410 kill-switch, ops-lite alerting, and the Phase A.0 symmetric-render HTML structural-diff gate (puxu.12). See `CLAUDE.md` for the per-feature module map.

Still genuinely deferred: the Astro migration (the site remains single-file HTML) and the tailnet/basicauth VPS deploy wiring for the operator-internal surfaces (a documented human-gated ops step).

## Anti-goals (hard refusal triggers — see DR-035 § 8)

- **No predicate URIs at `labs.*`** — predicate URIs live exclusively at `evals.intentsolutions.io`
- **No aggregate PASS%** across heterogeneous predicates (information-architecture lock + CI lint)
- **No partner-implicated bundle publication** without written consent
- **No asymmetric Phase A.0 rendering** — symmetric arms or blog-only fallback

## License

Apache 2.0.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). DCO sign-off required; conventional-commit titles; partner-name vendor-generic discipline enforced via CI grep gate.
