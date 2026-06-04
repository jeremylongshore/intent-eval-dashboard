#!/usr/bin/env node
/**
 * Results-browser site generator entrypoint — the `/results/` analogue of
 * `scripts/regenerate.py` (which generates the eval-set pages).
 *
 * Pipeline: read the verified ingest snapshots (the renderer's RenderInput) →
 * resolve content-addressed bundles to gate-result rows → apply the public
 * visibility-tier filter → emit self-contained HTML under `site/results/`.
 *
 * CURRENT STATE (2026-06): the emit-evidence work across the 6 source repos is
 * incomplete, so almost every repo has NO verified gate-result bundles yet. This
 * generator renders that no-data state correctly (loud, equal-weight-with-fail)
 * without crashing. As repos start emitting signed bundles, the ingest workers
 * (src/ingest) populate the snapshot store and rows appear here automatically.
 *
 * WIRING NOTE: the live snapshot/content stores are filesystem-backed on the VPS
 * (src/ingest/storage-fs.ts) and the gate-row source is supplied by the ingest
 * pipeline. This entrypoint defaults to the EMPTY/no-data view (the honest
 * current state) and accepts an injected RenderInput + resolver for tests and
 * for the wired-up Phase-2 ingest run. The deploy path is human-gated (rsync +
 * Caddy reload) and is NOT performed here.
 *
 * Usage (after `pnpm run build`):
 *   node --experimental-strip-types scripts/generate-results.ts [siteRoot]
 *
 * Imports the generator from the BUILT `dist/` (plain JS) so the script's own
 * type annotations strip cleanly and the import graph never needs runtime TS
 * transformation.
 *
 * Exit codes: 0 on success, 2 on IO/usage error.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RenderInput } from '../dist/ingest/renderer.js';
import { type BundleResolver } from '../dist/results/row-model.js';
import {
  buildPublicResultsView,
  generateResultsFiles,
  writeResultsSite,
} from '../dist/results/generate.js';

/** The 6 ingest repos (matches src/ingest/tree.ts INGEST_REPOS + fixtures). */
const INGEST_REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;

/**
 * The honest current-state RenderInput: every repo present, none with a
 * verified snapshot yet (null snapshot => no-data). When the ingest pipeline is
 * wired on the VPS this is replaced by the renderer's real RenderInput.
 */
function emptyCurrentStateInput(nowIso: string): RenderInput {
  return {
    asOf: nowIso,
    repos: INGEST_REPOS.map((repo) => ({ repo, snapshot: null })),
  };
}

/** A resolver that resolves nothing (no verified bundles exist yet). */
const NO_BUNDLES: BundleResolver = {
  resolve: () => Promise.resolve(null),
};

/**
 * Generate the results site into `siteRoot/site`.
 *
 * `input` + `resolver` default to the no-data current state; tests and the
 * wired ingest run pass real ones.
 */
export async function generate(
  siteRoot: string,
  input?: RenderInput,
  resolver?: BundleResolver,
  nowIso: string = new Date().toISOString(),
): Promise<string[]> {
  const renderInput = input ?? emptyCurrentStateInput(nowIso);
  const view = await buildPublicResultsView(renderInput, resolver ?? NO_BUNDLES, nowIso);
  const files = generateResultsFiles(view);
  return writeResultsSite(files, siteRoot);
}

async function main(argv: readonly string[]): Promise<number> {
  const siteRoot = resolve(process.cwd(), argv[0] ?? 'site');
  const written = await generate(siteRoot);
  console.log(`✓ generated ${written.length} results file(s) under ${siteRoot}`);
  for (const w of written) console.log(`  ${w}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('generate-results crashed:', err instanceof Error ? err.message : String(err));
      process.exit(2);
    });
}
