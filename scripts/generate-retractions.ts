#!/usr/bin/env node
/**
 * Retraction protocol generator entrypoint (bead puxu.10).
 *
 * Reads + validates the `retractions.json` denylist, then regenerates BOTH:
 *   - the Caddy 410 snippet  -> deploy/retractions.snippet
 *   - one tombstone HTML page per retraction -> site/retracted/<slug>/index.html
 *
 * NO Hugo / NO site rebuild (GC binding, DR-035 § 8): both outputs are flat
 * files. The retraction takes effect via git commit + rsync + caddy validate +
 * systemctl reload caddy (NEVER restart) — see the 4-hour SLO runbook in
 * 000-docs/. This script does NOT touch the VPS, Caddy, or any deploy workflow.
 *
 * If `retractions.json` is MISSING it is treated as empty (no retractions yet) —
 * a valid state that produces a no-op snippet + zero tombstones. If it is
 * PRESENT-but-INVALID (out-of-set reason_class, subject-less entry, bad JSON,
 * unknown field) the script FAILS CLOSED with a readable diagnostic and exits 1
 * — never a partial regeneration.
 *
 * Usage (after `pnpm run build`):
 *   node --experimental-strip-types scripts/generate-retractions.ts [retractions.json] [siteRoot]
 *
 * Defaults: retractions.json = src/retraction/retractions.json ; siteRoot = site.
 * The snippet always writes to deploy/retractions.snippet (off the public site
 * root — it is a Caddy config artifact, NOT served content).
 *
 * Imports the generator from the BUILT `dist/` (plain JS) so the script's own
 * type annotations strip cleanly under `--experimental-strip-types`.
 *
 * Exit codes: 0 success · 1 invalid denylist (fail closed) · 2 IO/usage error.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DenylistInvalidError,
  generateRetractions,
  type RetractionOutputPaths,
} from '../dist/retraction/generate.js';

const DEFAULT_JSON = 'src/retraction/retractions.json';
const SNIPPET_PATH = 'deploy/retractions.snippet';

async function main(argv: readonly string[]): Promise<number> {
  const jsonPath = resolve(process.cwd(), argv[0] ?? DEFAULT_JSON);
  const siteRoot = resolve(process.cwd(), argv[1] ?? 'site');
  const output: RetractionOutputPaths = {
    snippetPath: resolve(process.cwd(), SNIPPET_PATH),
    siteRoot,
  };

  try {
    const { artifacts, written } = await generateRetractions(jsonPath, output);
    const count = artifacts.tombstones.length;
    console.log(
      `✓ retraction protocol: ${count} retraction(s) -> 1 snippet + ${count} tombstone(s)`,
    );
    for (const w of written) console.log(`  ${w}`);
    console.log(
      '\nNext (human-gated VPS step — NOT performed here):\n' +
        '  1. git commit the regenerated snippet + tombstones\n' +
        '  2. rsync deploy/retractions.snippet -> /etc/caddy/retractions.snippet\n' +
        '  3. caddy validate   (NEVER skip)\n' +
        '  4. systemctl reload caddy   (reload — NEVER restart)\n' +
        '  See 000-docs/ retraction 4-hour SLO runbook.',
    );
    return 0;
  } catch (err) {
    if (err instanceof DenylistInvalidError) {
      console.error(`::error::retractions.json is INVALID — refusing to regenerate (fail closed).`);
      console.error(err.message);
      return 1;
    }
    console.error(
      'generate-retractions crashed:',
      err instanceof Error ? err.message : String(err),
    );
    return 2;
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(
        'generate-retractions crashed:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(2);
    });
}

export { main };
