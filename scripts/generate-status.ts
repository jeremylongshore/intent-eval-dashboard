#!/usr/bin/env node
/**
 * Freshness-strip + /status site generator entrypoint (puxu.7) — the freshness
 * analogue of `scripts/generate-results.ts`.
 *
 * Pipeline: take the verified gate-result rows + per-repo liveness + supervision
 * pressure → build the 24-bucket strip + the USE-method view → inject the strip
 * into the landing page and write `site/status/index.html`.
 *
 * CURRENT STATE (2026-06): emit-evidence across the 6 source repos is
 * incomplete, so the honest default has ZERO verified rows and ALL workers
 * silent. The strip therefore renders almost entirely `no-data` (loud red) and
 * /status shows 0/6 utilization. This is the truthful current picture and
 * exactly what the DR-035 C4 binding exists to surface — absence shown loudly,
 * never silently filled.
 *
 * As the ingest pipeline (src/ingest) starts producing verified snapshots, this
 * entrypoint is wired to the renderer's real RenderInput + the supervision
 * report; for now it defaults to the empty/no-data state and accepts injected
 * inputs for tests.
 *
 * Imports the generator from the BUILT `dist/` so the script strips cleanly.
 *
 * Usage (after `pnpm run build`):
 *   node --experimental-strip-types scripts/generate-status.ts [siteRoot]
 *
 * Exit codes: 0 on success, 2 on IO/usage error.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FreshnessInputs, generateAndWrite } from '../dist/freshness/generate.js';
import { type FreshnessRowInput } from '../dist/freshness/bucket-model.js';
import { type RepoLiveness, type SupervisionPressure } from '../dist/freshness/use-model.js';

/** The 6 ingest repos (matches src/ingest/tree.ts INGEST_REPOS). ICOS struck. */
const INGEST_REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;

/** Default per-repo restart budget × worker count (matches DEFAULT_INGEST_BUDGET). */
const RESTART_BUDGET = 3 * INGEST_REPOS.length;

/**
 * The honest current-state inputs: every repo present, none fresh, none with a
 * verified row in the window. Every bucket → no-data; utilization 0/6.
 */
function emptyCurrentStateInputs(nowIso: string): FreshnessInputs {
  const rows: FreshnessRowInput[] = [];
  const liveness: RepoLiveness[] = INGEST_REPOS.map((repo) => ({ repo, fresh: false }));
  const pressure: SupervisionPressure = {
    restartCount: 0,
    restartBudget: RESTART_BUDGET,
    escalatedChildIds: [],
  };
  return { repos: [...INGEST_REPOS], rows, liveness, pressure, nowIso };
}

async function main(argv: readonly string[]): Promise<number> {
  const siteRoot = resolve(process.cwd(), argv[0] ?? 'site');
  const nowIso = new Date().toISOString();
  const written = await generateAndWrite(emptyCurrentStateInputs(nowIso), siteRoot);
  console.log(`✓ generated ${written.length} freshness file(s) under ${siteRoot}`);
  for (const w of written) console.log(`  ${w}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('generate-status crashed:', err instanceof Error ? err.message : String(err));
      process.exit(2);
    });
}

export { main };
