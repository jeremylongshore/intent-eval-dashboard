# intent-eval-dashboard

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

**v0.1.0 in flight.** Phase 1 work tracked at [issue #1](https://github.com/jeremylongshore/intent-eval-dashboard/issues/1) (umbrella).

Ratified by ISEDC Session 8 — see [DR-035](https://github.com/jeremylongshore/intent-eval-lab/blob/main/000-docs/035-AT-DECR-isedc-council-session-8-labs-dashboard-2026-05-29.md) on the lab repo.

## What's here at v0.1.0

- **Eval-set browser** at `labs.intentsolutions.io/eval-sets/` — versioned, lineage-tracked spec rendering
- **Public anonymous root** — methodology docs, freshness strip (stub at v0.1.0), end-to-end signed example
- **Operator-internal view** — separate tailnet-only hostname, Tailscale identity, all reports regardless of public visibility tags

**Site format:** single-file HTML per page at v0.1.0 (zero build step; pure rsync deploy). Astro adopted at Phase 2 when interactive surfaces arrive. Acting-head decision 2026-05-30 — see plan file for reasoning.

## What ships in Phase 2

Schema evolution to `@intentsolutions/core@0.2.0` (adds `pre_registration_hash`, `retraction/v1`, `dashboard-render/v1`) · 6-worker ingest supervision tree · results browser · sign-your-own-homework (sequenced) · retraction protocol with Caddy kill-switch · ops-lite alerting · Phase A.0 symmetric rendering.

Phase 2 triggers when [`D28-PHASE-A0`](https://github.com/jeremylongshore/intent-eval-lab/blob/main/000-docs/028-AT-DECR-isedc-council-session-7-skill-refiner-plan-ratification-2026-05-27.md) returns.

## Anti-goals (hard refusal triggers — see DR-035 § 8)

- **No predicate URIs at `labs.*`** — predicate URIs live exclusively at `evals.intentsolutions.io`
- **No aggregate PASS%** across heterogeneous predicates (information-architecture lock + CI lint)
- **No partner-implicated bundle publication** without written consent
- **No asymmetric Phase A.0 rendering** — symmetric arms or blog-only fallback

## License

Apache 2.0.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). DCO sign-off required; conventional-commit titles; partner-name vendor-generic discipline enforced via CI grep gate.
