/**
 * intent-eval-dashboard — TypeScript ingest + supervision pipeline.
 *
 * The 6th repo of the Intent Eval Platform (public reports dashboard at
 * labs.intentsolutions.io). This entry point exposes the Armstrong-style
 * supervision tree + the verify-before-render ingest workers.
 *
 * SECURITY-CRITICAL: every ingest worker verifies signed evidence (pinned OIDC
 * identity → Rekor inclusion proof → DSSE signature → kernel schema) BEFORE any
 * bundle can be content-addressed, snapshotted, or rendered. The pipeline fails
 * CLOSED — a tampered/compromised input crashes the worker and the renderer
 * keeps serving the prior good snapshot. "render-without-reverify" is forbidden
 * (CTO + CISO independent refusals, DR-035 § 8).
 *
 * See `src/ingest/README.md` for the architecture + the production-wired vs
 * interface-seamed map.
 */

export * from './supervision/index.js';
export * from './ingest/index.js';
export * from './results/index.js';
