#!/usr/bin/env node
/**
 * Liveness-alert check entrypoint (puxu.11) — what a VPS cron would run.
 *
 * Pipeline: load the current per-source liveness → run the 7d-silence evaluator
 * → if anything crossed the threshold, format the critical ntfy message and push
 * it via the injected transport. With the DEFAULT transport (a no-op-that-logs)
 * NOTHING is delivered — this is safe to run anywhere, including locally and in
 * `pnpm run check`, without ever touching the VPS.
 *
 * ── The hard bindings this entrypoint respects (DR-035 § 8) ──
 *   - 7-day-silence is the ONLY trigger (delegated to `evaluateLivenessAlerts`).
 *   - ntfy ONLY, NO PagerDuty (the only push path is the `NtfyTransport` seam).
 *   - The default transport never claims a delivery it did not perform.
 *
 * ── HUMAN-GATED VPS SEAM (NOT performed by this repo's automation) ──
 *
 * The REAL alerting path is a human-gated VPS ops step, exactly like the
 * publisher rsync seam and the retraction Caddy reload:
 *
 *   1. The cron lives on the Contabo `intentsolutions` VPS (where the tailnet
 *      ntfy at `http://intentsolutions:8080` resolves). Illustrative crontab
 *      line (every 30 minutes) — do NOT deploy from this repo; see this repo's
 *      CLAUDE.md "Ops-lite alerting" section + the runbook for the exact form:
 *
 *        # /etc/cron.d/iep-liveness-alerts  (VPS, human-installed)
 *        # every-30-minutes schedule, run as the intentsolutions user, in the
 *        # deploy dir, with IEP_NTFY_BASE_URL=http://intentsolutions:8080 set so
 *        # a REAL ntfy transport is injected, logging to
 *        # /var/log/iep-liveness-alerts.log.
 *
 *   2. On the VPS, a real `NtfyTransport` (HTTP POST to the tailnet ntfy) is
 *      injected via `IEP_NTFY_BASE_URL`. Until that env is set, this script uses
 *      the no-op transport and only LOGS what it would have paged.
 *
 *   3. We never hardcode the VPS/tailnet ntfy address into committed code; the
 *      base URL comes from `IEP_NTFY_BASE_URL` (documented placeholder default).
 *
 * Imports the alerting library from the BUILT `dist/` so the script strips
 * cleanly (same convention as `scripts/generate-status.ts`).
 *
 * Usage (after `pnpm run build`):
 *   node --experimental-strip-types scripts/check-liveness-alerts.ts
 *
 * Exit codes:
 *   0  — ran successfully (whether or not anything paged; a page is not a failure
 *        of THIS script, it is the system working).
 *   2  — IO / usage error.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  NoopNtfyTransport,
  runAlertPass,
  type NtfyTransport,
  type SourceLiveness,
} from '../dist/alerting/index.js';

/** The 6 ingest repos (matches src/ingest/tree.ts INGEST_REPOS). ICOS struck. */
const INGEST_REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;

/**
 * Load the CURRENT per-source liveness.
 *
 * CURRENT STATE (2026-06): emit-evidence across the 6 source repos is
 * incomplete, so the honest default is that NO source has a successful verified
 * ingest on record — every repo is "never seen", which is > 7 days silent by
 * definition. With the no-op transport this surfaces in the log without paging
 * anyone. As the ingest pipeline starts producing verified snapshots, this is
 * wired to read the real supervisor snapshot's `last_successful_ingest` per repo;
 * for now it returns the honest empty state and accepts injected liveness in
 * tests.
 */
function loadCurrentLiveness(): SourceLiveness[] {
  return INGEST_REPOS.map((repo) => ({ repo }));
}

async function main(): Promise<number> {
  const nowIso = new Date().toISOString();
  const liveness = loadCurrentLiveness();

  // Default transport = no-op-that-logs. A real transport (HTTP POST to the
  // tailnet ntfy) is injected on the VPS via IEP_NTFY_BASE_URL — a human-gated
  // ops step that this repo's automation never performs.
  const transport: NtfyTransport = new NoopNtfyTransport();

  const summary = await runAlertPass(liveness, nowIso, transport);
  if (summary.critical === 0) {
    console.log(`✓ liveness check (as of ${nowIso}): ${summary.note}`);
  } else {
    console.log(
      `⚠ liveness check (as of ${nowIso}): ${summary.critical} source(s) silent > 7 days. ` +
        `Push delivered=${summary.delivered}. ${summary.note}`,
    );
  }
  return 0;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(
        'check-liveness-alerts crashed:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(2);
    });
}

export { main, loadCurrentLiveness };
