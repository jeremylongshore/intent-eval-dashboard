/**
 * Generator tests for the gated testing dashboard.
 *
 * Proves: the index is always emitted; a per-repo page is emitted per repo;
 * output is written under the internal site root (never the public `site/`);
 * and every generated file is structurally C3-clean.
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanForAggregatePass } from '../results/c3-scan.js';
import { buildTestingView } from './testing-row.js';
import { generateTestingFiles, writeTestingSite } from './generate-testing.js';
import {
  TestingFixtureResolver,
  explainerSet,
  renderInput,
  repoState,
  resolvedTestingRow,
} from './__fixtures__/testing-fixtures.js';

const EXPLAINERS = explainerSet([{ key: 'coverage' }, { key: 'gate-result' }, { key: '_index' }]);
const KA = 'sha256:' + 'a'.repeat(64);

async function viewWithData() {
  const resolver = new TestingFixtureResolver(
    new Map([
      [
        KA,
        [
          resolvedTestingRow({ gateName: 'coverage', decision: 'pass' }),
          resolvedTestingRow({ gateName: 'crap', decision: 'fail', gateReasons: ['x'] }),
        ],
      ],
    ]),
  );
  return buildTestingView(
    renderInput([repoState('iec', { bundleKeys: [KA] }), repoState('iel', { nullSnapshot: true })]),
    resolver,
  );
}

describe('generateTestingFiles', () => {
  it('always emits the index + one page per repo', async () => {
    const view = await viewWithData();
    const files = generateTestingFiles(view, EXPLAINERS);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('internal/testing/index.html');
    expect(paths).toContain('internal/testing/iec/index.html');
    expect(paths).toContain('internal/testing/iel/index.html');
  });

  it('emits only under internal/testing/, never the public results/ space', async () => {
    const view = await viewWithData();
    for (const f of generateTestingFiles(view, EXPLAINERS)) {
      expect(f.path.startsWith('internal/testing/')).toBe(true);
      expect(f.path.startsWith('results/')).toBe(false);
    }
  });

  it('every generated file is C3-clean', async () => {
    const view = await viewWithData();
    for (const f of generateTestingFiles(view, EXPLAINERS)) {
      expect(scanForAggregatePass(f.html)).toEqual([]);
    }
  });
});

describe('writeTestingSite', () => {
  it('writes under the internal site root, never site/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iep-testing-'));
    try {
      const internalRoot = join(dir, 'site-internal');
      const publicRoot = join(dir, 'site');
      const view = await viewWithData();
      const files = generateTestingFiles(view, EXPLAINERS);
      const written = await writeTestingSite(files, internalRoot);

      expect(written.length).toBe(files.length);
      const publicPrefix = publicRoot + sep;
      for (const w of written) {
        expect(w.startsWith(internalRoot + sep)).toBe(true);
        expect(w.startsWith(publicPrefix)).toBe(false);
      }
      const entries = await readdir(dir);
      expect(entries).toContain('site-internal');
      expect(entries).not.toContain('site');

      const indexHtml = await readFile(join(internalRoot, 'internal/testing/index.html'), 'utf8');
      expect(indexHtml).toContain('<!DOCTYPE html>');
      expect(indexHtml).toContain('Internal testing dashboard');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
