/**
 * Phase A.0 arm-symmetry — SYNTHETIC integrity test.
 *
 * The hard binding (DR-035 § 5 D2 + DR-028; CTO + VP DevRel refusals — see
 * CLAUDE.md "Hard refusal triggers": "No asymmetric Phase A.0 dashboard render
 * — symmetric arms or blog-only fallback"): the two Phase A.0 arms must render
 * with IDENTICAL structural treatment, so neither arm is given visual primacy.
 *
 * This test proves the scanner is REAL, not a doc:
 *   - the SYMMETRIC fixture (both arms identical skeleton) passes,
 *   - the ASYMMETRIC fixture (one arm gets a border-left accent + an extra
 *     <strong>) FAILS — the scanner returns diffs.
 *   - the LIVE Phase A.0 page passes (the actual rendered surface is symmetric).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  scanFiles,
  scanForArmAsymmetry,
  skeleton,
  type SymmetryDiff,
} from './arm-symmetry-scan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLEAN = join(HERE, '__fixtures__', 'arm-symmetry-clean.html');
const VIOLATION = join(HERE, '__fixtures__', 'arm-symmetry-violation.html');
const LIVE_PAGE = resolve(
  HERE,
  '..',
  '..',
  'site',
  'eval-sets',
  'j-rig-bench',
  'phase-a0',
  'index.html',
);

describe('arm-symmetry scanner — synthetic fixtures', () => {
  it('passes the SYMMETRIC fixture (both arms share one skeleton)', async () => {
    const html = await readFile(CLEAN, 'utf8');
    expect(scanForArmAsymmetry(html)).toEqual([]);
  });

  it('FAILS the ASYMMETRIC fixture (border-left accent + extra <strong> on one arm)', async () => {
    const html = await readFile(VIOLATION, 'utf8');
    const diffs = scanForArmAsymmetry(html);
    expect(diffs.length).toBeGreaterThanOrEqual(1);
    const regions = new Set(diffs.map((d) => d.region));
    // both injuries must be detected
    expect(regions.has('walkthrough')).toBe(true); // the border-left accent
    expect(regions.has('what')).toBe(true); // the extra <strong>
  });

  it('flags the border-left accent specifically as an inline-style asymmetry', async () => {
    const html = await readFile(VIOLATION, 'utf8');
    const diffs = scanForArmAsymmetry(html);
    const walk = diffs.find((d) => d.region === 'walkthrough');
    expect(walk).toBeDefined();
    // Arm B's first div token carries border-left; Arm A's does not.
    expect(walk?.armB).toContain('border-left');
    expect(walk?.armA).not.toContain('border-left');
  });

  it('scanFiles aggregates per-file results, omitting symmetric files', async () => {
    const clean = await readFile(CLEAN, 'utf8');
    const bad = await readFile(VIOLATION, 'utf8');
    const results = scanFiles([
      { file: CLEAN, content: clean },
      { file: VIOLATION, content: bad },
    ]);
    expect(results.map((r) => r.file)).toEqual([VIOLATION]);
  });

  it('treats a region present on only ONE arm as a violation (fail-closed)', () => {
    const halfRendered = `
      <!-- ARM-A:START id=solo -->Arm A only<!-- ARM-A:END id=solo -->
    `;
    const diffs = scanForArmAsymmetry(halfRendered);
    expect(diffs.length).toBe(1);
    expect(diffs[0]?.region).toBe('solo');
    expect(diffs[0]?.reason).toContain('missing for Arm B');
  });

  it('treats an unterminated arm marker as a violation', () => {
    const broken = `
      <!-- ARM-A:START id=oops --><div></div>
      <!-- ARM-B:START id=oops --><div></div><!-- ARM-B:END id=oops -->
    `;
    const diffs = scanForArmAsymmetry(broken);
    expect(diffs.some((d) => d.reason.includes('unterminated'))).toBe(true);
  });

  it('a page with NO arm markers is vacuously symmetric (not an A.0 arm page)', () => {
    expect(scanForArmAsymmetry('<html><body><p>nothing here</p></body></html>')).toEqual([]);
  });
});

describe('skeleton() — structural reduction', () => {
  it('strips text content but preserves tag sequence + emphasis tags', () => {
    expect(skeleton('<dd>some <strong>bold</strong> text</dd>')).toEqual([
      '<dd>',
      '<strong>',
      '</strong>',
      '</dd>',
    ]);
  });

  it('folds layout-affecting inline style into the token, ignores prose', () => {
    const a = skeleton('<div style="border-left: 3px solid #2c5282;">x</div>');
    const b = skeleton('<div>y</div>');
    expect(a).not.toEqual(b);
    expect(a[0]).toContain('border-left');
  });

  it('ignores non-layout attributes (href/id/class) — they do not bias prominence', () => {
    const a = skeleton('<a href="/one" id="x" class="link">A</a>');
    const b = skeleton('<a href="/two" id="y" class="link">B</a>');
    expect(a).toEqual(b);
  });

  it('folds colspan into the token (table layout symmetry)', () => {
    expect(skeleton('<td colspan="2">x</td>')[0]).toContain('colspan:2');
  });
});

describe('arm-symmetry — LIVE Phase A.0 page', () => {
  it('the actual rendered Phase A.0 page is structurally symmetric', async () => {
    const html = await readFile(LIVE_PAGE, 'utf8');
    const diffs = scanForArmAsymmetry(html);
    expect(
      diffs,
      `live page has asymmetric arm regions:\n${diffs
        .map((d: SymmetryDiff) => `  [${d.region}] ${d.reason}\n    A: ${d.armA}\n    B: ${d.armB}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  it('the live page actually DECLARES arm regions (the markers are present)', async () => {
    const html = await readFile(LIVE_PAGE, 'utf8');
    // Sanity: the gate would be vacuous if the page had no markers. Prove it does.
    expect(html).toMatch(/<!--\s*ARM-A:START\s+id=walkthrough\s*-->/);
    expect(html).toMatch(/<!--\s*ARM-B:START\s+id=walkthrough\s*-->/);
  });
});
