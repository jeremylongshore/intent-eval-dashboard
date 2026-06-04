#!/usr/bin/env node
/**
 * No-uptime-SLA-claim CI gate (puxu.11) — the grep-guard for the CFO binding.
 *
 * DR-035 § 8 (CFO refusal): NO misleading uptime claims on any public surface.
 * The literal "99.9% uptime" and uptime-guarantee language are FORBIDDEN in the
 * public output (`site/`). The public commitment is exactly "best-effort,
 * single-operator, see /status for liveness".
 *
 * This is a REAL scanner (detector in `src/alerting/no-uptime-scan.ts`), NOT a
 * doc. It walks the generated HTML under the target directory (default `site`)
 * and EXITS NON-ZERO on any uptime-SLA claim. The best-effort commitment string
 * is structurally safe (it is NOT a percent-near-uptime or a promise phrase).
 *
 * Usage (no build / no install needed):
 *   node --experimental-strip-types scripts/check-uptime-claims.ts [dir ...]
 *
 * The detector is fully self-contained (zero imports) so it strips cleanly under
 * `--experimental-strip-types` with no build — same as the C3 scanner.
 *
 * Exit codes:
 *   0  — clean (no uptime-SLA claims).
 *   1  — at least one uptime-SLA claim found.
 *   2  — usage / IO error.
 *
 * IMPORTANT (same lesson as the C3 gate): do NOT pipe stdout through `tee`
 * without `set -o pipefail` — the non-zero exit code would be masked. Run this
 * script directly so its exit code is the step's exit code.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForUptimeClaims, type UptimeClaim } from '../src/alerting/no-uptime-scan.ts';

/** Recursively collect every `.html` file under `target` (dir OR single file). */
async function collectHtml(target: string): Promise<string[]> {
  const out: string[] = [];
  let s;
  try {
    s = await stat(target);
  } catch {
    return out; // missing path => nothing to scan (not an error)
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
  const targets = argv.length > 0 ? argv : ['site'];
  const absTargets = targets.map((t) => resolve(process.cwd(), t));

  const files: string[] = [];
  for (const dir of absTargets) {
    files.push(...(await collectHtml(dir)));
  }

  if (files.length === 0) {
    console.log(
      `uptime-claim guard: no HTML files found under ${targets.join(', ')} — nothing to scan.`,
    );
    return 0;
  }

  let totalClaims = 0;
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const claims = scanForUptimeClaims(content);
    for (const c of claims) {
      totalClaims += 1;
      reportClaim(file, c);
    }
  }

  if (totalClaims > 0) {
    console.error(
      `\nUPTIME-CLAIM VIOLATION — ${totalClaims} uptime-SLA claim(s) found across ${files.length} file(s).`,
    );
    console.error(
      'This is a best-effort, single-operator dashboard. The public commitment is exactly:',
    );
    console.error('  "best-effort, single-operator, see /status for liveness"');
    console.error(
      'No uptime SLA / availability guarantee may appear on a public surface (DR-035 § 8).',
    );
    return 1;
  }

  console.log(
    `✓ uptime-claim guard: ${files.length} file(s) scanned, no uptime-SLA claims (best-effort commitment intact).`,
  );
  return 0;
}

function reportClaim(file: string, c: UptimeClaim): void {
  console.error(`::error file=${file}::uptime-SLA claim — "${c.match}" (rule: ${c.rule})`);
  console.error(`  file:    ${file}`);
  console.error(`  rule:    ${c.rule}`);
  console.error(`  match:   ${c.match}`);
  console.error(`  excerpt: …${c.excerpt}…`);
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(
        'uptime-claim guard crashed:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(2);
    });
}

export { main };
