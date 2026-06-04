/**
 * No-uptime-SLA-claim grep-guard tests (puxu.11).
 *
 * Proves the CFO binding: an uptime-SLA claim ("99.9% uptime" / uptime
 * guarantee / availability SLA / "four nines") in the public output is flagged;
 * the exact best-effort commitment string is NOT flagged; and the REAL generated
 * `site/` output is currently clean. Also asserts the public footer carries the
 * exact commitment language.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanForUptimeClaims, scanFilesForUptimeClaims } from './no-uptime-scan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '__fixtures__');
const REPO_ROOT = resolve(HERE, '..', '..');
const SITE_ROOT = join(REPO_ROOT, 'site');

/** The exact public commitment language (CFO binding). */
const COMMITMENT = 'best-effort, single-operator, see /status for liveness';

async function collectHtml(target: string): Promise<string[]> {
  const out: string[] = [];
  let s;
  try {
    s = await stat(target);
  } catch {
    return out;
  }
  if (s.isFile()) return target.endsWith('.html') ? [target] : [];
  if (!s.isDirectory()) return out;
  for (const entry of await readdir(target)) {
    const abs = join(target, entry);
    const child = await stat(abs);
    if (child.isDirectory()) out.push(...(await collectHtml(abs)));
    else if (entry.endsWith('.html')) out.push(abs);
  }
  return out;
}

describe('scanForUptimeClaims — flags uptime-SLA claims, not neutral prose', () => {
  it('flags the canonical "99.9% uptime" claim', () => {
    expect(scanForUptimeClaims('We deliver 99.9% uptime.')).not.toEqual([]);
  });

  it('flags "uptime" both before and after the percent', () => {
    expect(scanForUptimeClaims('uptime of 99.95%')).not.toEqual([]);
    expect(scanForUptimeClaims('99.99 % uptime')).not.toEqual([]);
  });

  it('flags promise phrasing: uptime guarantee / guaranteed uptime / uptime SLA', () => {
    expect(scanForUptimeClaims('our uptime guarantee')).not.toEqual([]);
    expect(scanForUptimeClaims('guaranteed uptime')).not.toEqual([]);
    expect(scanForUptimeClaims('uptime SLA')).not.toEqual([]);
  });

  it('flags availability SLA / X% availability / "four nines"', () => {
    expect(scanForUptimeClaims('SLA: 99.9%')).not.toEqual([]);
    expect(scanForUptimeClaims('99.95% availability')).not.toEqual([]);
    expect(scanForUptimeClaims('availability guarantee')).not.toEqual([]);
    expect(scanForUptimeClaims('four nines of availability')).not.toEqual([]);
  });

  it('does NOT flag the exact best-effort commitment string', () => {
    expect(scanForUptimeClaims(COMMITMENT)).toEqual([]);
  });

  it('does NOT flag neutral "liveness" / "status" prose', () => {
    expect(
      scanForUptimeClaims('See /status for liveness; the freshness strip shows current state.'),
    ).toEqual([]);
  });

  it('does NOT flag a bare unrelated percent ("7/10 pass", "95% coverage")', () => {
    expect(scanForUptimeClaims('Coverage is 95% on this module.')).toEqual([]);
    expect(scanForUptimeClaims('pass: 7 · fail: 3')).toEqual([]);
  });
});

describe('uptime-claim fixtures', () => {
  it('the violation fixture is flagged (every claim form)', async () => {
    const content = await readFile(join(FIXTURES, 'uptime-violation.html'), 'utf8');
    const claims = scanForUptimeClaims(content);
    expect(claims.length).toBeGreaterThanOrEqual(5);
    const rules = new Set(claims.map((c) => c.rule));
    expect(rules.has('percent-near-uptime')).toBe(true);
    expect(rules.has('uptime-promise')).toBe(true);
    expect(rules.has('availability-sla')).toBe(true);
    expect(rules.has('nines-shorthand')).toBe(true);
  });

  it('the clean fixture (with the best-effort footer) is NOT flagged', async () => {
    const content = await readFile(join(FIXTURES, 'uptime-clean.html'), 'utf8');
    expect(scanForUptimeClaims(content)).toEqual([]);
    // and it actually carries the commitment language
    expect(content).toContain(COMMITMENT);
  });

  it('scanFilesForUptimeClaims returns only the offending file', async () => {
    const clean = await readFile(join(FIXTURES, 'uptime-clean.html'), 'utf8');
    const dirty = await readFile(join(FIXTURES, 'uptime-violation.html'), 'utf8');
    const results = scanFilesForUptimeClaims([
      { file: 'uptime-clean.html', content: clean },
      { file: 'uptime-violation.html', content: dirty },
    ]);
    expect(results.map((r) => r.file)).toEqual(['uptime-violation.html']);
  });
});

describe('the REAL public site/ output carries no uptime-SLA claim', () => {
  it('every site/*.html is clean', async () => {
    const files = await collectHtml(SITE_ROOT);
    // The site is generated in `pnpm run check` before this gate; if it has not
    // been generated yet locally there may be fewer files — but any present must
    // be clean.
    const pairs = await Promise.all(
      files.map(async (f) => ({ file: f, content: await readFile(f, 'utf8') })),
    );
    const offenders = scanFilesForUptimeClaims(pairs);
    expect(offenders).toEqual([]);
  });

  it('the public landing footer carries the exact best-effort commitment', async () => {
    const landing = await readFile(join(SITE_ROOT, 'index.html'), 'utf8');
    expect(landing).toContain(COMMITMENT);
  });
});
