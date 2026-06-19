#!/usr/bin/env node
/**
 * Gated internal testing-dashboard generator entrypoint (beads nr75.1 + nr75.2).
 *
 * Renders the per-repo testing pages (coverage / mutation / CRAP / architecture
 * / escape-scan, each TAUGHT) by joining the verified gate-result view with the
 * authored explainers in `content/explainers/`. Output goes under
 * `site-internal/internal/testing/` — DEFAULT and NOT overridable to `site/`.
 *
 * ── SURFACE ──
 *
 * Unlike the tailnet-only operator-RESULTS view (`scripts/generate-internal.ts`),
 * this dashboard is served behind Caddy **basicauth** at
 * `internal.intentsolutions.io` (the gate decision is recorded in the design DR
 * + the DR-035 § 8 successor-DR addendum). This entrypoint does NOT touch the
 * VPS, Caddy, or any deploy workflow — that wiring is the documented human-gated
 * follow-up (`deploy/internal-testing.caddy` + the runbook).
 *
 * CURRENT STATE (2026-06): emit-evidence is incomplete upstream, so every repo
 * has NO verified bundles yet. This generator renders that no-data state
 * correctly (loud, equal-weight-with-fail) with the full teaching scaffold still
 * present — so the page is readable and instructive before the first real result
 * lands.
 *
 * Usage (after `pnpm run build`):
 *   node --experimental-strip-types scripts/generate-internal-testing.ts [internalSiteRoot]
 *
 * Defaults `internalSiteRoot` to `site-internal`. Passing `site` is REFUSED.
 * Imports the generator from the BUILT `dist/` so the script's own type
 * annotations strip cleanly under `--experimental-strip-types`.
 *
 * Exit codes: 0 on success, 2 on IO/usage error.
 */

import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RenderInput } from '../dist/ingest/renderer.js';
import {
  buildTestingView,
  generateTestingFiles,
  loadExplainers,
  writeTestingSite,
  type ExplainerSet,
  type TestingBundleResolver,
} from '../dist/internal-testing/index.js';

/** The ingest repos (matches src/ingest/tree.ts INGEST_REPOS + the results lane). */
const INGEST_REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;

/**
 * The honest current-state RenderInput: every repo present, none with a verified
 * snapshot yet (null snapshot => no-data). Replaced by the renderer's real
 * RenderInput once the ingest pipeline is wired on the VPS.
 */
function emptyCurrentStateInput(nowIso: string): RenderInput {
  return {
    asOf: nowIso,
    repos: INGEST_REPOS.map((repo) => ({ repo, snapshot: null })),
  };
}

/** A resolver that resolves nothing (no verified bundles exist yet). */
const NO_BUNDLES: TestingBundleResolver = {
  resolve: () => Promise.resolve(null),
};

/**
 * Generate the gated testing dashboard into `internalSiteRoot`.
 *
 * `input` + `resolver` default to the no-data current state; tests and the wired
 * ingest run pass real ones. `explainers` defaults to loading `content/explainers/`.
 */
export async function generate(
  internalSiteRoot: string,
  input?: RenderInput,
  resolver?: TestingBundleResolver,
  explainers?: ExplainerSet,
  nowIso: string = new Date().toISOString(),
): Promise<string[]> {
  const renderInput = input ?? emptyCurrentStateInput(nowIso);
  const exp = explainers ?? (await loadExplainers(resolve(process.cwd(), 'content/explainers')));
  const view = await buildTestingView(renderInput, resolver ?? NO_BUNDLES);
  const files = generateTestingFiles(view, exp);
  return writeTestingSite(files, internalSiteRoot);
}

async function main(argv: readonly string[]): Promise<number> {
  const requested = argv[0] ?? 'site-internal';
  // Refuse to write the gated testing output into the PUBLIC origin. The strict
  // site/ vs site-internal/ separation is the load-bearing binding.
  if (basename(requested) === 'site') {
    console.error(
      'generate-internal-testing: refusing to write gated testing output into the public origin "site/". ' +
        'Use the default "site-internal" (this output is served behind basicauth, never from the public origin).',
    );
    return 2;
  }
  const internalSiteRoot = resolve(process.cwd(), requested);
  const written = await generate(internalSiteRoot);
  console.log(
    `✓ generated ${written.length} gated testing-dashboard file(s) under ${internalSiteRoot}`,
  );
  console.log(
    '  (basicauth-gated at internal.intentsolutions.io — NOT served from the public origin)',
  );
  for (const w of written) console.log(`  ${w}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(
        'generate-internal-testing crashed:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(2);
    });
}

export { main };
