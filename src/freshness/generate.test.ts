/**
 * Freshness generator tests (puxu.7).
 *
 * Covers:
 *   - injectStrip replaces the marker region in place (idempotent) + preserves
 *     surrounding content;
 *   - injectStrip THROWS when markers are absent (never silently appends);
 *   - generateFreshnessFiles emits index.html (injected) + status/index.html;
 *   - the generated files are C3-clean;
 *   - writeFreshnessSite + generateAndWrite round-trip on a temp dir, including
 *     the 25h-silent worker rendering loud no-data on the written page.
 */

import { mkdtemp, readFile, rm, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type FreshnessRowInput } from './bucket-model.js';
import { type RepoLiveness, type SupervisionPressure } from './use-model.js';
import {
  buildFreshness,
  generateAndWrite,
  generateFreshnessFiles,
  injectStrip,
  STRIP_MARKER_CLOSE,
  STRIP_MARKER_OPEN,
  writeFreshnessSite,
  type FreshnessInputs,
} from './generate.js';
import { scanForAggregatePass } from '../results/c3-scan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LANDING_FIXTURE = join(HERE, '__fixtures__', 'landing-fixture.html');

const REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;
const NOW = '2026-06-04T12:30:00.000Z';
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (h: number): string => new Date(Date.parse(NOW) - h * HOUR_MS).toISOString();

const PRESSURE: SupervisionPressure = {
  restartCount: 0,
  restartBudget: 18,
  escalatedChildIds: [],
};

function inputs(rows: FreshnessRowInput[], liveness?: RepoLiveness[]): FreshnessInputs {
  return {
    repos: [...REPOS],
    rows,
    liveness: liveness ?? REPOS.map((repo) => ({ repo, fresh: false })),
    pressure: PRESSURE,
    nowIso: NOW,
  };
}

describe('injectStrip', () => {
  it('replaces the marker region in place and preserves surrounding content', async () => {
    const landing = await readFile(LANDING_FIXTURE, 'utf8');
    const out = injectStrip(landing, '<section class="freshness-strip-grid">INJECTED</section>');
    expect(out).toContain('INJECTED');
    expect(out).toContain(STRIP_MARKER_OPEN);
    expect(out).toContain(STRIP_MARKER_CLOSE);
    // Surrounding content intact.
    expect(out).toContain('Rest of the page is untouched');
    expect(out).toContain('must survive injection verbatim');
  });

  it('is idempotent — re-injecting replaces, never duplicates', async () => {
    const landing = await readFile(LANDING_FIXTURE, 'utf8');
    const once = injectStrip(landing, '<section>A</section>');
    const twice = injectStrip(once, '<section>B</section>');
    expect(twice).toContain('B');
    expect(twice).not.toContain('>A<');
    // exactly one marker pair remains
    const markerRe = new RegExp(STRIP_MARKER_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    expect([...twice.matchAll(markerRe)]).toHaveLength(1);
  });

  it('THROWS when markers are absent (never silently appends)', () => {
    expect(() => injectStrip('<html><body>no markers here</body></html>', 'X')).toThrow(
      /markers not found/,
    );
  });
});

describe('generateFreshnessFiles', () => {
  it('emits index.html (injected) + status/index.html', async () => {
    const landing = await readFile(LANDING_FIXTURE, 'utf8');
    const build = buildFreshness(inputs([]));
    const files = generateFreshnessFiles(build, landing);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(['index.html', 'status/index.html']);

    const index = files.find((f) => f.path === 'index.html');
    expect(index?.html).toContain('freshness-strip-grid');
    expect(index?.html).toContain('Rest of the page is untouched'); // landing preserved

    const status = files.find((f) => f.path === 'status/index.html');
    expect(status?.html).toContain('<!DOCTYPE html>');
    expect(status?.html).toContain('Utilization');
  });

  it('generated files are C3-clean (no cross-predicate aggregate PASS%)', async () => {
    const landing = await readFile(LANDING_FIXTURE, 'utf8');
    // Mix of decisions to ensure the strip renders real cells, still C3-clean.
    const rows: FreshnessRowInput[] = [
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'pass' },
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'fail' },
      { repo: 'iel', evaluatedAt: hoursAgo(2), decision: 'advisory' },
    ];
    const build = buildFreshness(inputs(rows));
    const files = generateFreshnessFiles(build, landing);
    for (const f of files) {
      expect(scanForAggregatePass(f.html)).toEqual([]);
    }
  });
});

describe('generateAndWrite — disk round-trip', () => {
  it('writes index + status and the 25h-silent worker shows loud no-data on the page', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'freshness-gen-'));
    try {
      // Seed the temp site with the landing fixture as index.html.
      await mkdir(dir, { recursive: true });
      await cp(LANDING_FIXTURE, join(dir, 'index.html'));

      const rows: FreshnessRowInput[] = [
        { repo: 'iaj', evaluatedAt: hoursAgo(25), decision: 'pass' }, // 25h silent
        { repo: 'iec', evaluatedAt: hoursAgo(0.2), decision: 'pass' }, // fresh
      ];
      const written = await generateAndWrite(inputs(rows), dir);
      expect(written.map((w) => w.replace(dir + '/', '')).sort()).toEqual([
        'index.html',
        'status/index.html',
      ]);

      const index = await readFile(join(dir, 'index.html'), 'utf8');
      // The 25h-silent repo row carries loud no-data and NO pass cell.
      const iajRowRe = /<th scope="row"[^>]*><a href="\/results\/iaj\/">[\s\S]*?<\/tr>/;
      const iajRow = iajRowRe.exec(index)?.[0] ?? '';
      expect(iajRow).toContain('bucket--no-data');
      expect(iajRow).not.toContain('bucket--pass');

      const status = await readFile(join(dir, 'status', 'index.html'), 'utf8');
      expect(status).toContain('Fully silent sources');
      expect(status).toContain('iaj');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writeFreshnessSite creates nested dirs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'freshness-write-'));
    try {
      const written = await writeFreshnessSite(
        [{ path: 'deep/nested/page.html', html: '<!DOCTYPE html><html></html>' }],
        dir,
      );
      expect(written).toHaveLength(1);
      const content = await readFile(join(dir, 'deep/nested/page.html'), 'utf8');
      expect(content).toContain('<!DOCTYPE html>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generateAndWrite throws when the landing page lost its markers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'freshness-nomark-'));
    try {
      await writeFile(
        join(dir, 'index.html'),
        '<!DOCTYPE html><html><body>no markers</body></html>',
        'utf8',
      );
      await expect(generateAndWrite(inputs([]), dir)).rejects.toThrow(/markers not found/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
