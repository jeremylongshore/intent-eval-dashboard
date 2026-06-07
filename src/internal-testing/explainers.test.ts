/**
 * Explainer loader + matcher tests.
 *
 * Proves: only `*.md` loads; a doc's first `# ` is the title (else the key);
 * a missing dir degrades to an empty set (data-only render, never a crash);
 * gate-name → explainer matching does exact → alias → generic fallback; and the
 * REAL authored explainer set carries the gates Phase 1 ships.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  explainerFor,
  GENERIC_EXPLAINER_KEY,
  INDEX_EXPLAINER_KEY,
  loadExplainers,
} from './explainers.js';
import { explainerSet } from './__fixtures__/testing-fixtures.js';

describe('loadExplainers', () => {
  it('loads only *.md, derives title from the first `# `, ignores other files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iep-expl-'));
    try {
      await writeFile(join(dir, 'coverage.md'), '# Coverage\n\n## What it is\n\nLines run.', 'utf8');
      await writeFile(join(dir, 'notitle.md'), 'No heading here.\n', 'utf8');
      await writeFile(join(dir, 'notes.txt'), 'ignored', 'utf8');

      const set = await loadExplainers(dir);
      expect([...set.keys()].sort()).toEqual(['coverage', 'notitle']);

      const cov = set.get('coverage');
      expect(cov?.title).toBe('Coverage');
      expect(cov?.html).toContain('<h2>What it is</h2>');
      expect(cov?.html).toContain('<p>Lines run.</p>');
      // The title line is consumed, not re-rendered into the body.
      expect(cov?.html).not.toContain('Coverage</h1>');

      // No `# ` heading → title defaults to the key.
      expect(set.get('notitle')?.title).toBe('notitle');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty set for a missing directory (degrades, never crashes)', async () => {
    const set = await loadExplainers(join(tmpdir(), 'iep-does-not-exist-' + 'z'.repeat(8)));
    expect(set.size).toBe(0);
  });
});

describe('explainerFor — exact → alias → generic', () => {
  const set = explainerSet([
    { key: 'coverage', title: 'Coverage' },
    { key: 'crap', title: 'CRAP' },
    { key: GENERIC_EXPLAINER_KEY, title: 'Gate result' },
  ]);

  it('matches an exact gate name', () => {
    expect(explainerFor(set, 'coverage')?.key).toBe('coverage');
  });

  it('matches a known alias (crap-score → crap)', () => {
    expect(explainerFor(set, 'crap-score')?.key).toBe('crap');
  });

  it('falls back to the generic explainer for an unknown gate', () => {
    expect(explainerFor(set, 'totally-unknown-gate')?.key).toBe(GENERIC_EXPLAINER_KEY);
  });

  it('returns undefined when not even the generic explainer is loaded', () => {
    const bare = explainerSet([{ key: 'coverage' }]);
    expect(explainerFor(bare, 'totally-unknown-gate')).toBeUndefined();
  });
});

describe('the REAL authored explainer set', () => {
  it('carries every gate Phase 1 ships + the index + generic fallback', async () => {
    const set = await loadExplainers('content/explainers');
    for (const key of [
      'coverage',
      'mutation',
      'crap',
      'architecture',
      'escape-scan',
      GENERIC_EXPLAINER_KEY,
      INDEX_EXPLAINER_KEY,
    ]) {
      expect(set.has(key), `missing explainer: ${key}`).toBe(true);
    }
    // Each carries rendered HTML.
    expect(set.get('coverage')?.html).toContain('<h2>');
  });
});
