#!/usr/bin/env node
/**
 * Per-skill signals site generator entrypoint (wave-2 — bead ig4h.6).
 *
 * The `/skills/` analogue of `scripts/generate-results.ts`: build the per-skill
 * adoption + human-trust + authoring-quality view from verified kernel entities
 * (via a SkillSignalResolver seam) → emit self-contained HTML under
 * `site/skills/`.
 *
 * CURRENT STATE (2026-06): the adoption-score values are produced upstream by
 * j-rig (`UsageEvent` ingest) and the `HumanReview` capture verb — both being
 * built in parallel (DR-103 Items 1/2/4/5). Until that pipeline lands, NO skill
 * has a verified signal, so this generator renders the honest all-no-data state
 * (loud, fail-equal weight) without crashing. When the upstream signals land, a
 * production SkillSignalResolver (re-validating each entity against the kernel
 * schemas) replaces the no-data resolver and cards populate automatically.
 *
 * Imports the generator from the BUILT `dist/` (plain JS) so this script's own
 * type annotations strip cleanly under `--experimental-strip-types` with no
 * runtime TS transformation (mirrors generate-results.ts).
 *
 * Usage (after `pnpm run build`):
 *   node --experimental-strip-types scripts/generate-skills.ts [siteRoot]
 *
 * Exit codes: 0 on success, 2 on IO/usage error.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type SkillSignalResolver } from '../dist/skills/skill-signal-model.js';
import { buildSkillsFiles, writeSkillsSite } from '../dist/skills/generate-skills.js';

/**
 * The candidate skill list the dashboard tracks. v0.1.0 ships the all-no-data
 * baseline; this list seeds the page so each tracked skill shows a loud no-data
 * card until its upstream signals are wired. Kept deliberately small + honest.
 */
const TRACKED_SKILLS = ['validate-skillmd', 'skill-creator', 'audit-tests'] as const;

/** A resolver that resolves nothing (no verified signals exist yet). */
const NO_SIGNALS: SkillSignalResolver = {
  resolve: () => Promise.resolve(null),
};

/**
 * Generate the skills site into `siteRoot/skills`.
 *
 * `skills` + `resolver` default to the no-data current state; tests and the
 * wired ingest run pass real ones.
 */
export async function generate(
  siteRoot: string,
  skills: readonly string[] = TRACKED_SKILLS,
  resolver: SkillSignalResolver = NO_SIGNALS,
): Promise<string[]> {
  const files = await buildSkillsFiles(skills, resolver);
  return writeSkillsSite(files, siteRoot);
}

async function main(argv: readonly string[]): Promise<number> {
  const siteRoot = resolve(process.cwd(), argv[0] ?? 'site');
  const written = await generate(siteRoot);
  console.log(`✓ generated ${written.length} skills file(s) under ${siteRoot}`);
  for (const w of written) console.log(`  ${w}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('generate-skills crashed:', err instanceof Error ? err.message : String(err));
      process.exit(2);
    });
}
