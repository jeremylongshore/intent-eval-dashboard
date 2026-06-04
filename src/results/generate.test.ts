/**
 * Generator tests — public-visibility filtering, file-map structure, disk write.
 *
 * The KEY integrity assertion: a Tier-2-without-consent row is ABSENT from the
 * generated public output (no per-repo page row, no per-bundle deep-link page).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyPublicVisibility,
  buildPublicResultsView,
  generateResultsFiles,
  pathFromUrl,
  writeResultsSite,
} from './generate.js';
import { buildResultsView, type ResultsView } from './row-model.js';
import { bundleUrl, repoUrl } from './render-html.js';
import {
  FixtureResolver,
  renderInput,
  repoState,
  resolvedRow,
} from './__fixtures__/results-fixtures.js';

const NOW = '2026-05-30T12:00:00.000Z';

describe('applyPublicVisibility', () => {
  it('drops Tier-2-no-consent rows and flips an all-gated repo to no-data', async () => {
    const k = 'sha256:' + '1'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([
        [
          k,
          [
            resolvedRow({ gateName: 'public', visibility: { tier: 'tier-1' } }),
            resolvedRow({ gateName: 'internal', visibility: { tier: 'tier-2' } }), // dropped
          ],
        ],
      ]),
    );
    const raw = await buildResultsView(
      renderInput([repoState('iec', { bundleKeys: [k] })]),
      resolver,
    );
    expect(raw.repos[0]?.rows).toHaveLength(2); // pre-filter

    const pub = applyPublicVisibility(raw, NOW);
    expect(pub.repos[0]?.rows.map((r) => r.gateName)).toEqual(['public']);
    expect(pub.repos[0]?.noData).toBe(false);
  });

  it('flips a repo with ONLY non-public rows to no-data (never partial pass)', async () => {
    const k = 'sha256:' + '2'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([[k, [resolvedRow({ visibility: { tier: 'tier-2' } }), resolvedRow({ visibility: { tier: 'tier-3' } })]]]),
    );
    const raw = await buildResultsView(renderInput([repoState('iec', { bundleKeys: [k] })]), resolver);
    const pub = applyPublicVisibility(raw, NOW);
    expect(pub.repos[0]?.noData).toBe(true);
    expect(pub.repos[0]?.rows).toEqual([]);
  });
});

describe('buildPublicResultsView', () => {
  it('composes resolve → view → public-filter', async () => {
    const k = 'sha256:' + '3'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([[k, [resolvedRow({ visibility: { tier: 'tier-1' } })]]]),
    );
    const view = await buildPublicResultsView(
      renderInput([repoState('iec', { bundleKeys: [k] })]),
      resolver,
      NOW,
    );
    expect(view.repos[0]?.rows).toHaveLength(1);
  });
});

describe('generateResultsFiles', () => {
  it('emits index + per-repo + per-bundle pages', async () => {
    const k = 'sha256:' + '4'.repeat(64);
    const resolver = new FixtureResolver(new Map([[k, [resolvedRow({ visibility: { tier: 'tier-1' } })]]]));
    const view = await buildPublicResultsView(
      renderInput([repoState('iec', { bundleKeys: [k] })]),
      resolver,
      NOW,
    );
    const files = generateResultsFiles(view);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('results/index.html');
    expect(paths).toContain(pathFromUrl(repoUrl('iec')));
    expect(paths).toContain(pathFromUrl(bundleUrl('iec', k)));
  });

  it('does NOT emit a per-bundle deep-link page for a Tier-2-no-consent row', async () => {
    const kPub = 'sha256:' + '5'.repeat(64);
    const kInt = 'sha256:' + '6'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([
        [kPub, [resolvedRow({ visibility: { tier: 'tier-1' } })]],
        [kInt, [resolvedRow({ visibility: { tier: 'tier-2' } })]], // internal, no consent
      ]),
    );
    const view = await buildPublicResultsView(
      renderInput([repoState('iec', { bundleKeys: [kPub, kInt] })]),
      resolver,
      NOW,
    );
    const files = generateResultsFiles(view);
    const paths = files.map((f) => f.path);
    // public bundle is present; internal bundle's deep link is ABSENT (404)
    expect(paths).toContain(pathFromUrl(bundleUrl('iec', kPub)));
    expect(paths).not.toContain(pathFromUrl(bundleUrl('iec', kInt)));
    // and the internal bundle key appears nowhere in the rendered output
    const allHtml = files.map((f) => f.html).join('\n');
    expect(allHtml).not.toContain(kInt);
  });

  it('emits an index even when every repo is no-data', async () => {
    const resolver = new FixtureResolver(new Map());
    const view: ResultsView = await buildPublicResultsView(
      renderInput([repoState('iec', { nullSnapshot: true }), repoState('iel', { nullSnapshot: true })]),
      resolver,
      NOW,
    );
    const files = generateResultsFiles(view);
    expect(files.map((f) => f.path)).toContain('results/index.html');
    expect(files.find((f) => f.path === 'results/index.html')?.html).toContain('no-data');
  });
});

describe('pathFromUrl', () => {
  it('maps a site URL to a file path', () => {
    expect(pathFromUrl('/results/iec/')).toBe('results/iec/index.html');
    expect(pathFromUrl('/results/')).toBe('results/index.html');
  });
});

describe('writeResultsSite', () => {
  it('writes generated files to disk under the site root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iep-results-'));
    try {
      const k = 'sha256:' + '7'.repeat(64);
      const resolver = new FixtureResolver(new Map([[k, [resolvedRow({ visibility: { tier: 'tier-1' } })]]]));
      const view = await buildPublicResultsView(
        renderInput([repoState('iec', { bundleKeys: [k] })]),
        resolver,
        NOW,
      );
      const files = generateResultsFiles(view);
      const written = await writeResultsSite(files, dir);
      expect(written.length).toBe(files.length);
      const indexHtml = await readFile(join(dir, 'results/index.html'), 'utf8');
      expect(indexHtml).toContain('<!DOCTYPE html>');
      expect(indexHtml).toContain('Results');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
