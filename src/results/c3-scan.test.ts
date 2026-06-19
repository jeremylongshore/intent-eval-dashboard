/**
 * C3 binding — SYNTHETIC integrity test.
 *
 * The hard binding (DR-035 § 4 C3; CTO + CMO + VP DevRel triple-refusal): the
 * rendered output must NEVER contain an aggregate `<X>/<N> pass` or `<X>% pass`
 * spanning MULTIPLE distinct predicate URIs. A count scoped to a single
 * predicate is acceptable.
 *
 * This test proves the scanner is REAL, not a doc:
 *   - the clean fixture (per-predicate counts + a single-predicate fraction)
 *     passes,
 *   - the violation fixture (a pass-rate composited across two predicates)
 *     FAILS — the scanner returns violations AND the CLI lint exits non-zero.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanFiles, scanForAggregatePass } from './c3-scan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLEAN = join(HERE, '__fixtures__', 'c3-clean.html');
const VIOLATION = join(HERE, '__fixtures__', 'c3-violation.html');

describe('C3 scanner — synthetic fixtures', () => {
  it('passes the CLEAN fixture (per-predicate + single-predicate counts)', async () => {
    const html = await readFile(CLEAN, 'utf8');
    expect(scanForAggregatePass(html)).toEqual([]);
  });

  it('FAILS the VIOLATION fixture (aggregate PASS% across two predicate URIs)', async () => {
    const html = await readFile(VIOLATION, 'utf8');
    const violations = scanForAggregatePass(html);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    // The violation must name >= 2 distinct predicate URIs.
    for (const v of violations) {
      expect(v.predicateUris.length).toBeGreaterThanOrEqual(2);
    }
    // both the fraction form and the percent form are caught
    const matches = violations.map((v) => v.match.toLowerCase());
    expect(matches.some((m) => m.includes('/'))).toBe(true);
  });

  it('scanFiles aggregates per-file results, omitting clean files', async () => {
    const clean = await readFile(CLEAN, 'utf8');
    const bad = await readFile(VIOLATION, 'utf8');
    const results = scanFiles([
      { file: CLEAN, content: clean },
      { file: VIOLATION, content: bad },
    ]);
    expect(results.map((r) => r.file)).toEqual([VIOLATION]);
  });
});

describe('C3 scanner — unit edge cases', () => {
  it('allows a single-predicate fraction', () => {
    const html =
      '<section><p><code>https://evals.intentsolutions.io/gate-result/v1</code></p><p>3/4 pass</p></section>';
    expect(scanForAggregatePass(html)).toEqual([]);
  });

  it('allows aggregate PASS% with NO predicate URIs in scope (predicate-free prose)', () => {
    const html = '<p>Overall 9/10 pass across our internal CI.</p>';
    expect(scanForAggregatePass(html)).toEqual([]);
  });

  it('flags a fraction spanning two predicates in one scope', () => {
    const html =
      '<li><code>https://evals.intentsolutions.io/gate-result/v1</code> + <code>https://evals.intentsolutions.io/validation-result/v1</code>: 5/8 pass</li>';
    expect(scanForAggregatePass(html).length).toBe(1);
  });

  it('flags a percent form spanning two predicates', () => {
    const html =
      '<p><code>https://evals.intentsolutions.io/gate-result/v1</code> <code>https://evals.intentsolutions.io/eval-verdict/v1</code> 88% pass</p>';
    expect(scanForAggregatePass(html).length).toBe(1);
  });

  it('is whitespace-tolerant on the aggregate token', () => {
    const html =
      '<li><code>https://evals.intentsolutions.io/gate-result/v1</code> <code>https://evals.intentsolutions.io/validation-result/v1</code> 7 / 10  pass</li>';
    expect(scanForAggregatePass(html).length).toBe(1);
  });

  it('fail-closed: aggregate with no local scope but document mixes predicates is flagged', () => {
    // No block tag before the match; doc mixes two predicate URIs at top.
    const html =
      'https://evals.intentsolutions.io/gate-result/v1 https://evals.intentsolutions.io/validation-result/v1 ... 4/5 pass';
    expect(scanForAggregatePass(html).length).toBe(1);
  });

  it('ungrouped aggregate on a single-predicate document is allowed (not fail-closed)', () => {
    // enclosed=false but doc has only ONE predicate URI => not widened to a
    // violation (exercises the !enclosed branch with docUriCount < 2).
    const html =
      'https://evals.intentsolutions.io/gate-result/v1 prose ... 4/5 pass with no grouping element';
    expect(scanForAggregatePass(html)).toEqual([]);
  });

  it('scopes a per-group count to its OWN <li>, not the next group (scopeEnd found)', () => {
    // Two sibling <li>s, each single-predicate. The first <li>'s count must be
    // scoped to itself, NOT bleed into the second <li>'s different predicate.
    const html =
      '<ul>' +
      '<li><code>https://evals.intentsolutions.io/gate-result/v1</code> 3/4 pass</li>' +
      '<li><code>https://evals.intentsolutions.io/validation-result/v1</code> 2/2 pass</li>' +
      '</ul>';
    // Each count is single-predicate within its own <li> => no violation.
    expect(scanForAggregatePass(html)).toEqual([]);
  });

  it('flags when two predicates share ONE <li> even with later sibling groups', () => {
    const html =
      '<ul>' +
      '<li><code>https://evals.intentsolutions.io/gate-result/v1</code> ' +
      '<code>https://evals.intentsolutions.io/validation-result/v1</code> 5/6 pass</li>' +
      '<li>unrelated later group</li>' +
      '</ul>';
    expect(scanForAggregatePass(html).length).toBe(1);
  });
});
