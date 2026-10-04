/**
 * HTML render tests — structure, no-data equal-weight, stale badge, 4-timestamp
 * surface, as-of banner, deep links, and the C3-safe per-predicate breakdown.
 */

import { describe, expect, it } from 'vitest';
import {
  bundleUrl,
  esc,
  renderAllEvalsPage,
  renderBundlePage,
  renderRepoPage,
  renderResultsIndex,
  repoUrl,
  slug,
  specUrl,
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
  it('wraps each wide result table in a closed keyboard-accessible scroll region', () => {
    const html = renderResultsIndex({ asOf: 'x', repos: [repo(), repo({ repo: 'iel' })] });
    const wrappers =
      html.match(
        /<div class="table-scroll" role="region" aria-label="Detailed test results" tabindex="0"><table class="results-table">[\s\S]*?<\/table><\/div>/g,
      ) ?? [];
    expect(wrappers).toHaveLength(2);
    expect((html.match(/<div(?:\s|>)/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
  });

  it('emits a valid self-contained page (DOCTYPE + close + stylesheet)', () => {
    const view: ResultsView = { asOf: '2026-05-30T12:00:05.000Z', repos: [repo()] };
    const html = renderResultsIndex(view);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<link rel="stylesheet" href="/style.css">');
  });

  it('keeps generated pages inside the Intent Solutions site network', () => {
    const html = renderResultsIndex({ asOf: 'x', repos: [repo()] });
    expect(html).toContain('aria-label="Intent Solutions network"');
    expect(html).toContain('https://evals.intentsolutions.io/');
    expect(html).toContain('https://learn.intentsolutions.io/');
    expect(html).toContain('href="/start/"');
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

const POLICY_HASH = 'a'.repeat(64);
const SPEC_PATH = 'plugins/saas-packs/demo-pack/skills/demo-skill/eval-spec.yaml';
const FULL_SHA = 'a9dd5c02a3793412ed35525efd460b399554be13';

describe('specUrl', () => {
  it('links a jrig policy_ref to the exact spec at the full commit', () => {
    expect(specUrl('jrig', `sha256:${POLICY_HASH}:${SPEC_PATH}@a9dd5c02a379`, FULL_SHA)).toBe(
      `https://github.com/jeremylongshore/tons-of-skills-marketplace/blob/${FULL_SHA}/${SPEC_PATH}`,
    );
  });
  it('keeps the policy_ref commit when commit_sha is a different commit', () => {
    const other = 'b'.repeat(40);
    expect(specUrl('jrig', `sha256:${POLICY_HASH}:${SPEC_PATH}@a9dd5c02a379`, other)).toBe(
      `https://github.com/jeremylongshore/tons-of-skills-marketplace/blob/a9dd5c02a379/${SPEC_PATH}`,
    );
  });
  it('refuses repos with no known spec source', () => {
    expect(specUrl('iec', `sha256:${POLICY_HASH}:${SPEC_PATH}@a9dd5c02a379`)).toBeNull();
  });
  it('refuses malformed refs and traversal', () => {
    expect(specUrl('jrig', 'not-a-ref')).toBeNull();
    expect(specUrl('jrig', `sha256:${POLICY_HASH}:../etc/passwd@a9dd5c02a379`)).toBeNull();
    expect(specUrl('jrig', `sha256:${POLICY_HASH}:a//b.yaml@a9dd5c02a379`)).toBeNull();
    expect(specUrl('jrig', `sha256:${POLICY_HASH}:a b.yaml@a9dd5c02a379`)).toBeNull();
  });
});

describe('renderAllEvalsPage', () => {
  const jrigRow = row({
    repo: 'jrig',
    gateName: 'demo-skill',
    decision: 'fail',
    reasons: ['7/10 criteria passed on model-x', 'thresholds did not pass'],
    policyRef: `sha256:${POLICY_HASH}:${SPEC_PATH}@a9dd5c02a379`,
    commitSha: FULL_SHA,
  });
  const view: ResultsView = {
    asOf: '2026-05-30T12:00:05.000Z',
    repos: [
      repo({ repo: 'jrig', rows: [jrigRow] }),
      repo({ repo: 'iec', rows: [row({ gateName: 'escape-scan' })] }),
      repo({ repo: 'qmd', rows: [], noData: true }),
    ],
  };
  const html = renderAllEvalsPage(view);

  it('lists every eval with its signed record, project, reason and spec link', () => {
    expect(html).toContain(`href="${bundleUrl('jrig', jrigRow.bundleKey)}"`);
    expect(html).toContain('<code>demo-skill</code>');
    expect(html).toContain('<code>escape-scan</code>');
    expect(html).toContain('7/10 criteria passed on model-x');
    expect(html).not.toContain('thresholds did not pass'); // headline only
    expect(html).toContain(`blob/${FULL_SHA}/${SPEC_PATH}`);
    expect(html).toContain(`href="${repoUrl('iec')}"`);
  });
  it('names no-data sources loudly instead of dropping them', () => {
    expect(html).toContain('badge--no-data');
    expect(html).toContain(`href="${repoUrl('qmd')}"`);
  });
  it('groups by predicate URI and stays C3-clean with two predicates', () => {
    const mixed: ResultsView = {
      ...view,
      repos: [repo({ rows: [row(), row({ predicateUri: VALIDATION_URI, gateName: 'v' })] })],
    };
    const out = renderAllEvalsPage(mixed);
    expect(out.match(/<section class="all-evals">/g)).toHaveLength(2);
    expect(scanForAggregatePass(out)).toEqual([]);
    expect(scanForAggregatePass(html)).toEqual([]);
  });
  it('escapes reasons from the signed body', () => {
    const out = renderAllEvalsPage({
      repos: [repo({ rows: [row({ reasons: ['<script>x</script>'] })] })],
    });
    expect(out).not.toContain('<script>x');
    expect(out).toContain('&lt;script&gt;x');
  });
  it('renders an explicit empty state when nothing is published', () => {
    expect(renderAllEvalsPage({ repos: [] })).toContain(
      'No verified eval results have been published yet.',
    );
  });
});

describe('renderBundlePage reasons', () => {
  it('shows every signed reason and the spec link under the table', () => {
    const r = row({
      repo: 'jrig',
      reasons: ['first reason', 'second reason'],
      policyRef: `sha256:${POLICY_HASH}:${SPEC_PATH}@a9dd5c02a379`,
    });
    const html = renderBundlePage('jrig', r.bundleKey, [r]);
    expect(html).toContain('<li>first reason</li>');
    expect(html).toContain('<li>second reason</li>');
    expect(html).toContain('>eval spec</a>');
  });
  it('omits the why section for rows without reasons or policy', () => {
    expect(renderBundlePage('iec', row().bundleKey, [row()])).not.toContain('<h2>Why</h2>');
  });
  it('shows an unlinkable policy_ref as plain text', () => {
    const r = row({ policyRef: 'policy/v1' });
    expect(renderBundlePage('iec', r.bundleKey, [r])).toContain('<code>policy/v1</code>');
  });
});
