#!/usr/bin/env node
/**
 * C3 CI gate — refuse cross-predicate aggregate PASS% in rendered output.
 *
 * DR-035 § 4 C3 binding (CTO + CMO + VP DevRel independent refusals): the
 * rendered `/results/` output must NEVER contain a laundered aggregate pass
 * metric. Any `<X>/<N> pass` or `<X>% pass` spanning MULTIPLE distinct predicate
 * URIs is FORBIDDEN. A count scoped to a SINGLE predicate URI is allowed.
 *
 * This is a REAL scanner (see `src/results/c3-scan.ts` for the detector), NOT a
 * doc. It walks the generated HTML under the target directory (default
 * `site/results`) and EXITS NON-ZERO on any violation.
 *
 * Usage (no build / no install needed):
 *   node --experimental-strip-types scripts/lint-no-aggregate-pass.ts [dir ...]
 *
 * The scanner (`src/results/c3-scan.ts`) is fully self-contained — zero imports
 * — so it strips cleanly under `--experimental-strip-types` with no build, no
 * dependency install, and no kernel checkout. This keeps the C3 gate cheap and
 * runnable in any CI job (including the static deploy job).
 *
 * Exit codes:
 *   0  — no violations (clean)
 *   1  — at least one cross-predicate aggregate-PASS% violation
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
import { scanForAggregatePass, type C3Violation } from '../src/results/c3-scan.ts';

/** Recursively collect every `.html` file under `target` (dir OR single file). */
async function collectHtml(target: string): Promise<string[]> {
  const out: string[] = [];
  let s;
  try {
    s = await stat(target);
  } catch {
    return out; // missing path => nothing to scan (not an error: results may be absent)
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
  const targets = argv.length > 0 ? argv : ['site/results'];
  const absTargets = targets.map((t) => resolve(process.cwd(), t));

  const files: string[] = [];
  for (const dir of absTargets) {
    files.push(...(await collectHtml(dir)));
  }

  if (files.length === 0) {
    console.log(
      `C3 aggregate-PASS% lint: no HTML files found under ${targets.join(', ')} — nothing to scan (results not yet generated).`,
    );
    return 0;
  }

  let totalViolations = 0;
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const violations = scanForAggregatePass(content);
    for (const v of violations) {
      totalViolations += 1;
      reportViolation(file, v);
    }
  }

  if (totalViolations > 0) {
    console.error(
      `\nC3 VIOLATION — ${totalViolations} cross-predicate aggregate-PASS% metric(s) found across ${files.length} file(s).`,
    );
    console.error(
      'This is the banned "metric laundering": a pass-rate cannot span heterogeneous predicate URIs.',
    );
    return 1;
  }

  console.log(
    `✓ C3 aggregate-PASS% lint: ${files.length} file(s) scanned, no cross-predicate aggregate-PASS% violations.`,
  );
  return 0;
}

function reportViolation(file: string, v: C3Violation): void {
  // GitHub Actions error annotation + human-readable detail.
  console.error(
    `::error file=${file}::C3 violation — aggregate "${v.match}" spans ${v.predicateUris.length} predicate URIs`,
  );
  console.error(`  file:      ${file}`);
  console.error(`  match:     ${v.match}`);
  console.error(`  predicates: ${v.predicateUris.join(', ')}`);
  console.error(`  excerpt:   …${v.excerpt}…`);
}

// Run only when invoked directly (not when imported).
const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error('C3 lint crashed:', err instanceof Error ? err.message : String(err));
      process.exit(2);
    });
}

export { main };
