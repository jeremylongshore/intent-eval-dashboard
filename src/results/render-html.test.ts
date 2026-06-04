/**
 * HTML render tests — structure, no-data equal-weight, stale badge, 4-timestamp
 * surface, as-of banner, deep links, and the C3-safe per-predicate breakdown.
 */

import { describe, expect, it } from 'vitest';
import {
  bundleUrl,
  esc,
  renderBundlePage,
  renderRepoPage,
  renderResultsIndex,
  repoUrl,
  slug,
} from './render-html.js';
import { scanForAggregatePass } from './c3-scan.js';
import { type RepoResults, type ResultsRow, type ResultsView } from './row-model.js';
import { GATE_RESULT_URI, VALIDATION_URI } from './__fixtures__/results-fixtures.js';

function row(over: Partial<ResultsRow> = {}): ResultsRow {
  return {
    repo: 'iec',
    bundleKey: 'sha256:' + 'a'.repeat(64),
    rowIndex: 0,
    predicateUri: GATE_RESULT_URI,
    decision: 'pass',
    gateName: 'escape-scan',
    evaluatedAt: '2026-05-30T11:59:00.000Z',
    bundleCreatedAt: '2026-05-30T12:00:00.000Z',
    rekorLogIndices: [1689291334],
    ingestedAt: '2026-05-30T12:00:05.000Z',
    visibility: { tier: 'tier-1' },
    ...over,
  };
}

function repo(over: Partial<RepoResults> = {}): RepoResults {
  return {
    repo: 'iec',
    rows: [row()],
    noData: false,
    ingestedAt: '2026-05-30T12:00:05.000Z',
    ...over,
  };
}

const ALL_TS = (html: string, r: ResultsRow): boolean =>
  html.includes(r.evaluatedAt) &&
  html.includes(r.bundleCreatedAt) &&
  html.includes(String(r.rekorLogIndices[0])) &&
  html.includes(r.ingestedAt);

describe('helpers', () => {
  it('esc neutralises HTML metacharacters', () => {
    expect(esc('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('slug + URL builders are stable', () => {
    expect(slug('sha256:ABCdef')).toBe('sha256-abcdef');
    expect(repoUrl('iec')).toBe('/results/iec/');
    expect(bundleUrl('iec', 'sha256:' + 'a'.repeat(4))).toBe('/results/iec/sha256-aaaa/');
  });
});

describe('renderResultsIndex', () => {
  it('emits a valid self-contained page (DOCTYPE + close + stylesheet)', () => {
    const view: ResultsView = { asOf: '2026-05-30T12:00:05.000Z', repos: [repo()] };
    const html = renderResultsIndex(view);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<link rel="stylesheet" href="/style.css">');
  });

  it('renders the as-of banner = min(ingested_at)', () => {
    const view: ResultsView = { asOf: '2026-05-30T09:00:00.000Z', repos: [repo()] };
    const html = renderResultsIndex(view);
    expect(html).toContain('As of:');
    expect(html).toContain('2026-05-30T09:00:00.000Z');
    expect(html).toContain('min(ingested_at)');
  });

  it('renders a loud as-of banner when no source has a snapshot', () => {
    // No ingestedAt at all => no-data repo with no snapshot timestamp.
    const noSnapshotRepo: RepoResults = { repo: 'iec', rows: [], noData: true };
    const view: ResultsView = { repos: [noSnapshotRepo] };
    const html = renderResultsIndex(view);
    expect(html).toContain('as-of--none');
    expect(html).toContain('no source has a verified snapshot');
  });

  it('renders the per-repo freshness strip', () => {
    const html = renderResultsIndex({ asOf: 'x', repos: [repo()] });
    expect(html).toContain('Per-repo freshness');
    expect(html).toContain('<table class="freshness-strip">');
  });

  it('renders all 4 timestamps per row (never collapsed)', () => {
    const r = row();
    const html = renderResultsIndex({ asOf: 'x', repos: [repo({ rows: [r] })] });
    expect(ALL_TS(html, r)).toBe(true);
    // headers present
    expect(html).toContain('Evaluated at');
    expect(html).toContain('Bundle created at');
    expect(html).toContain('Rekor anchor');
    expect(html).toContain('Ingested at');
  });

  it('renders a no-data panel (equal weight) for a no-data repo, not a pass', () => {
    const html = renderResultsIndex({ repos: [repo({ noData: true, rows: [] })] });
    expect(html).toContain('no-data-panel');
    expect(html).toContain('No data is not a pass');
    expect(html).toContain('badge--no-data');
    // must NOT render a pass badge for a no-data repo
    expect(html).not.toContain('badge--result-pass');
  });

  it('renders a stale_since badge when serving a prior-good snapshot', () => {
    const html = renderResultsIndex({
      repos: [repo({ staleSince: '2026-05-29T00:00:00.000Z' })],
    });
    expect(html).toContain('badge--stale');
    expect(html).toContain('stale since 2026-05-29T00:00:00.000Z');
  });

  it('links to per-repo and per-bundle deep links', () => {
    const r = row();
    const html = renderResultsIndex({ repos: [repo({ rows: [r] })] });
    expect(html).toContain(repoUrl('iec'));
    expect(html).toContain(bundleUrl('iec', r.bundleKey));
  });

  it('renders per-predicate decision counts (C3-safe) and no cross-predicate aggregate', () => {
    const rows = [
      row({ predicateUri: GATE_RESULT_URI, decision: 'pass', gateName: 'g1' }),
      row({ predicateUri: GATE_RESULT_URI, decision: 'fail', gateName: 'g2' }),
      row({ predicateUri: VALIDATION_URI, decision: 'pass', gateName: 'v1' }),
    ];
    const html = renderResultsIndex({ repos: [repo({ rows })] });
    // per-predicate breakdown text
    expect(html).toContain('per predicate URI');
    expect(html).toContain('pass: 1');
    expect(html).toContain('fail: 1');
    // C3 scanner finds NO cross-predicate aggregate
    expect(scanForAggregatePass(html)).toEqual([]);
  });
});

describe('renderRepoPage', () => {
  it('renders one repo page with as-of + back link', () => {
    const view: ResultsView = { asOf: 'x', repos: [repo()] };
    const html = renderRepoPage(view, repo());
    expect(html).toContain('← All results');
    expect(html).toContain('Results: <code>iec</code>');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('renders a no-data repo page as the loud panel', () => {
    const view: ResultsView = { repos: [repo({ noData: true, rows: [] })] };
    const html = renderRepoPage(view, repo({ noData: true, rows: [] }));
    expect(html).toContain('no-data-panel');
  });
});

describe('renderBundlePage', () => {
  it('renders a deep-link page with content-key provenance', () => {
    const r = row();
    const html = renderBundlePage('iec', r.bundleKey, [r]);
    expect(html).toContain('content key');
    expect(html).toContain(r.bundleKey);
    expect(html).toContain('survives an upstream force-push');
    expect(ALL_TS(html, r)).toBe(true);
  });

  it('renders no-data for an empty bundle', () => {
    const html = renderBundlePage('iec', 'sha256:' + 'a'.repeat(64), []);
    expect(html).toContain('no-data-panel');
  });
});
