/**
 * Ops-lite alerting (bead puxu.11 / amber-lighthouse Epic 2.8).
 *
 * The minimal alerting layer for the public reports dashboard. Three hard
 * bindings from DR-035 § 8 are enforced here in code + test:
 *
 *   - evaluate — the ONLY paging trigger: a source silent > 7 days → critical.
 *     No latency/error-rate/threshold pagers (CISO + CFO).
 *   - ntfy     — formats the critical message + the injectable push seam. ntfy
 *     ONLY (topic `prod-alerts`), NO PagerDuty (CFO). The default transport is a
 *     no-op-that-logs — never claims a successful send.
 *   - no-uptime-scan — the grep-guard detector that fails if any uptime-SLA
 *     claim ("99.9% uptime", "uptime guarantee", …) appears in the public site.
 *     The public commitment is exactly "best-effort, single-operator, see
 *     /status for liveness" (CFO).
 *
 * The real ntfy push and the VPS cron that runs the check are human-gated ops
 * seams (documented in scripts/check-liveness-alerts.ts + this repo's CLAUDE.md),
 * NOT performed by this library.
 */

export * from './evaluate.js';
export * from './ntfy.js';
export * from './no-uptime-scan.js';
export * from './run.js';
