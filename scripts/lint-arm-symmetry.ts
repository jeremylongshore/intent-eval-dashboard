#!/usr/bin/env node
/**
 * Phase A.0 arm-symmetry CI gate — refuse asymmetric A.0 arm rendering.
 *
 * DR-035 § 5 D2 + DR-028 binding (CTO + VP DevRel independent refusals; see
 * CLAUDE.md "Hard refusal triggers": "No asymmetric Phase A.0 dashboard render
 * — symmetric arms or blog-only fallback"): the two Phase A.0 arms (Arm A
 * "Naive-Opus-in-context"/"just ask" and Arm B "the Refiner") MUST render with
 * IDENTICAL structural treatment. Neither arm may carry a layout accent, an
 * extra emphasis, or a different tag skeleton that the other lacks.
 *
 * This is a REAL structural-diff scanner (see `src/results/arm-symmetry-scan.ts`
 * for the detector), NOT a doc. It walks the generated HTML under the target
 * path(s), reduces each ARM-A/ARM-B marked region to a structural skeleton
 * (tags + emphasis + layout-affecting inline style, prose stripped), and EXITS
 * NON-ZERO if any arm pair diverges.
 *
 * Usage (no build / no install needed):
 *   node --experimental-strip-types scripts/lint-arm-symmetry.ts [path ...]
 *
 * The scanner (`src/results/arm-symmetry-scan.ts`) is fully self-contained —
 * zero imports — so it strips cleanly under `--experimental-strip-types` with
 * no build, no dependency install, and no kernel checkout. This keeps the gate
 * cheap and runnable in the static-deploy job.
 *
 * Exit codes:
 *   0  — every arm pair is symmetric (or no arm-marked pages found)
 *   1  — at least one asymmetric arm region
 *   2  — usage / IO error
 *
 * IMPORTANT (learned from intent-eval-core's boundary-check.yml `| tee` bug):
 * the CI step that runs this MUST NOT pipe stdout through `tee` without
 * `set -o pipefail`, or the non-zero exit code is masked by tee's exit 0. Run
 * this script directly so its exit code is the step's exit code.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForArmAsymmetry, type SymmetryDiff } from '../src/results/arm-symmetry-scan.ts';

/** Default scan target: the Phase A.0 page tree. */
const DEFAULT_TARGET = 'site/eval-sets/j-rig-bench';

/** Recursively collect every `.html` file under `target` (dir OR single file). */
async function collectHtml(target: string): Promise<string[]> {
  const out: string[] = [];
  let s;
  try {
    s = await stat(target);
  } catch {
    return out; // missing path => nothing to scan
  }
  if (s.isFile()) {
    return target.endsWith('.html') ? [target] : [];
  }
  if (!s.isDirectory()) return out;
  const entries = await readdir(target);
  for (const entry of entries) {
    const abs = join(target, entry);
    const child = await stat(abs);
    if (child.isDirectory()) {
      out.push(...(await collectHtml(abs)));
    } else if (entry.endsWith('.html')) {
      out.push(abs);
    }
  }
  return out;
}

async function main(argv: readonly string[]): Promise<number> {
  const targets = argv.length > 0 ? argv : [DEFAULT_TARGET];
  const absTargets = targets.map((t) => resolve(process.cwd(), t));

  const files: string[] = [];
  for (const dir of absTargets) {
    files.push(...(await collectHtml(dir)));
  }

  if (files.length === 0) {
    console.log(
      `Arm-symmetry lint: no HTML files found under ${targets.join(', ')} — nothing to scan.`,
    );
    return 0;
  }

  let totalDiffs = 0;
  let armPages = 0;
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    // Only pages that DECLARE arm regions are A.0 arm pages.
    if (!/<!--\s*ARM-[AB]:START/i.test(content)) continue;
    armPages += 1;
    const diffs = scanForArmAsymmetry(content);
    for (const d of diffs) {
      totalDiffs += 1;
      reportDiff(file, d);
    }
  }

  if (totalDiffs > 0) {
    console.error(
      `\nARM-SYMMETRY VIOLATION — ${totalDiffs} asymmetric arm region(s) found across ${armPages} A.0 arm page(s).`,
    );
    console.error(
      'DR-035 § 5 D2 (CTO + VP DevRel refusal): both Phase A.0 arms must render with identical structural treatment — neither arm may be given visual primacy.',
    );
    return 1;
  }

  console.log(
    `✓ Arm-symmetry lint: ${armPages} A.0 arm page(s) scanned (${files.length} HTML file(s) total), all arm pairs structurally symmetric.`,
  );
  return 0;
}

function reportDiff(file: string, d: SymmetryDiff): void {
  console.error(
    `::error file=${file}::Arm-symmetry violation in region "${d.region}" — ${d.reason}`,
  );
  console.error(`  file:   ${file}`);
  console.error(`  region: ${d.region}`);
  console.error(`  reason: ${d.reason}`);
  console.error(`  Arm A:  ${truncate(d.armA)}`);
  console.error(`  Arm B:  ${truncate(d.armB)}`);
}

function truncate(s: string): string {
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
}

// Run only when invoked directly (not when imported).
const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('Arm-symmetry lint crashed:', err instanceof Error ? err.message : String(err));
      process.exit(2);
    });
}

export { main };
