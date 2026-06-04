/**
 * Retraction protocol (bead puxu.10) — the INTEGRITY capability to take down a
 * published attestation honestly.
 *
 * Public surface:
 *   - denylist  — the `retractions.json` format + validator (closed-set
 *     reason_class, at-least-one-subject, strict). GC + CISO bindings.
 *   - statement — derive + kernel-validate the `retraction/v1` in-toto Statement
 *     from a denylist entry; signing seam (no faked signatures).
 *   - snippet   — Caddy 410 `retractions.snippet` generator.
 *   - tombstone — public disclosure HTML generator (append-only honesty).
 *   - generate  — orchestrator: denylist -> snippet + tombstones.
 *   - paths     — deterministic tombstone path derivation shared by the above.
 *
 * The schema + predicate body are NOT redefined here — they are imported from
 * `@intentsolutions/core` (the kernel is the source of truth).
 */

export * from './denylist.js';
export * from './statement.js';
export * from './snippet.js';
export * from './tombstone.js';
export * from './paths.js';
export * from './generate.js';
