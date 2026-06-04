#!/usr/bin/env node
/**
 * Operator-internal results site generator entrypoint (bead puxu.9) — the
 * TAILNET-ONLY analogue of `scripts/generate-results.ts`.
 *
 * This is the INVERSE of the public generator: it renders EVERY verified
 * gate-result row regardless of visibility tier (Tier-1 incl. under embargo,
 * Tier-2 incl. no-consent, Tier-3 all appear), annotated with each row's tier so
 * an operator on the tailnet can see WHY a row is or isn't public.
 *
 * ── HARD SEPARATION (the whole reason puxu.9 exists) ──
 *
 * Output is written under `site-internal/` — DEFAULT and NOT overridable to
 * `site/`. The public Caddy block serves `site/`; the public `deploy.yml` only
 * globs `site/**` (its `paths:` trigger, smoke-file checks, and C3 scan all
 * target `site`), so `site-internal/` is never wired into the public origin. A
 * future, human-gated, Tailscale-identity-gated Caddy block will serve
 * `site-internal/` on a tailnet-only hostname. This entrypoint does NOT touch
 * the VPS, Caddy, or any deploy workflow — that wiring is the documented
 * human-gated follow-up.
 *
 * CURRENT STATE (2026-06): emit-evidence across the 6 source repos is
 * incomplete, so almost every repo has NO verified bundles yet. This generator
 * renders that no-data state correctly (loud, equal-weight-with-fail) without
 * crashing — identical to the public generator's honest current picture.
 *
 * Usage (after `pnpm run build`):
 *   node --experimental-strip-types scripts/generate-internal.ts [internalSiteRoot]
 *
 * If `internalSiteRoot` is omitted it defaults to `site-internal`. Passing
 * `site` (the public origin) is REFUSED — the separation is load-bearing.
 *
 * Imports the generator from the BUILT `dist/` (plain JS) so the script's own
 * type annotations strip cleanly under `--experimental-strip-types`.
 *
 * Exit codes: 0 on success, 2 on IO/usage error.
 */

import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type RenderInput } from '../dist/ingest/renderer.js';
import { type BundleResolver } from '../dist/results/row-model.js';
import {
  buildInternalResultsView,
  buildInternalUse,
  generateInternalFiles,
  writeInternalSite,
} from '../dist/results/generate-internal.js';

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
 * Generate the operator-internal site into `internalSiteRoot`.
 *
 * `input` + `resolver` default to the no-data current state; tests and the
 * wired ingest run pass real ones. Crucially this builds the view WITHOUT the
 * public visibility filter — every tier is rendered.
 */
export async function generate(
  internalSiteRoot: string,
  input?: RenderInput,
  resolver?: BundleResolver,
  nowIso: string = new Date().toISOString(),
): Promise<string[]> {
  const renderInput = input ?? emptyCurrentStateInput(nowIso);
  const view = await buildInternalResultsView(renderInput, resolver ?? NO_BUNDLES);
  const use = buildInternalUse(view, nowIso);
  const files = generateInternalFiles(view, use, nowIso);
  return writeInternalSite(files, internalSiteRoot);
}

async function main(argv: readonly string[]): Promise<number> {
  const requested = argv[0] ?? 'site-internal';
  // Refuse to write the operator-internal output into the PUBLIC origin. The
  // strict site/ vs site-internal/ separation is the load-bearing binding.
  if (basename(requested) === 'site') {
    console.error(
      'generate-internal: refusing to write operator-internal output into the public origin "site/". ' +
        'Use the default "site-internal" (this output is tailnet-only and must never be served publicly).',
    );
    return 2;
  }
  const internalSiteRoot = resolve(process.cwd(), requested);
  const written = await generate(internalSiteRoot);
  console.log(`✓ generated ${written.length} operator-internal file(s) under ${internalSiteRoot}`);
  console.log('  (tailnet-only — NOT served from the public origin; see README "Operator-internal view")');
  for (const w of written) console.log(`  ${w}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('generate-internal crashed:', err instanceof Error ? err.message : String(err));
      process.exit(2);
    });
}

export { main };
