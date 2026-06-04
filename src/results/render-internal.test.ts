/**
 * Operator-internal renderer tests (bead puxu.9).
 *
 * Covers the visibility-badge logic (the operator "why public / why not"), the
 * noindex/nofollow + tailnet-only head markers, the operator banner, and the
 * internal URL/deep-link shape.
 */

import { describe, expect, it } from 'vitest';
import {
  internalBundleUrl,
  internalRepoUrl,
  renderInternalBundlePage,
  renderInternalIndex,
  renderInternalRepoPage,
  visibilityBadge,
} from './render-internal.js';
import { buildInternalResultsView, buildInternalUse } from './generate-internal.js';
import { type ResultsRow } from './row-model.js';
import {
  FixtureResolver,
  renderInput,
  repoState,
  resolvedRow,
} from './__fixtures__/results-fixtures.js';

const NOW = '2026-05-30T12:00:00.000Z';
const FUTURE_EMBARGO = '2099-01-01T00:00:00.000Z';

/** Build a minimal ResultsRow for the badge unit tests. */
function row(visibility: ResultsRow['visibility']): ResultsRow {
  return {
    repo: 'iec',
    bundleKey: 'sha256:' + 'a'.repeat(64),
    rowIndex: 0,
    predicateUri: 'https://evals.intentsolutions.io/gate-result/v1',
    decision: 'pass',
    gateName: 'escape-scan',
    evaluatedAt: '2026-05-30T11:59:00.000Z',
    bundleCreatedAt: '2026-05-30T12:00:00.000Z',
    rekorLogIndices: [1],
    ingestedAt: '2026-05-30T12:00:05.000Z',
    visibility,
  };
}

describe('visibilityBadge', () => {
  it('marks a Tier-1 (no embargo) row as public', () => {
    const html = visibilityBadge(row({ tier: 'tier-1' }), NOW);
    expect(html).toContain('tier 1 — public');
    expect(html).toContain('vis-badge--public');
  });

  it('marks a Tier-2-no-consent row internal-only with the no-consent reason', () => {
    const html = visibilityBadge(row({ tier: 'tier-2' }), NOW);
    expect(html).toContain('no consent');
    expect(html).toContain('internal-only');
    expect(html).toContain('vis-badge--internal');
  });

  it('marks a consented Tier-2 row as public', () => {
    const html = visibilityBadge(row({ tier: 'tier-2', consent: true }), NOW);
    expect(html).toContain('tier 2 — public');
  });

  it('marks a Tier-3 row internal-only with the case-by-case reason', () => {
    const html = visibilityBadge(row({ tier: 'tier-3' }), NOW);
    expect(html).toContain('case-by-case');
    expect(html).toContain('internal-only');
  });

  it('marks an embargoed Tier-1 row internal-only with the embargo reason', () => {
    const html = visibilityBadge(row({ tier: 'tier-1', embargoUntil: FUTURE_EMBARGO }), NOW);
    expect(html).toContain('under embargo');
    expect(html).toContain('internal-only');
  });

  it('marks a past-embargo Tier-1 row as public', () => {
    const html = visibilityBadge(
      row({ tier: 'tier-1', embargoUntil: '2020-01-01T00:00:00.000Z' }),
      NOW,
    );
    expect(html).toContain('tier 1 — public');
  });

  it('fails closed for an unknown tier (defensive — never surfaces it as public)', () => {
    // A row that somehow carries a tier outside the closed set. The view-model's
    // coerceTier normally prevents this, so this is the defensive last line.
    const html = visibilityBadge(
      row({ tier: 'tier-9' as ResultsRow['visibility']['tier'] }),
      NOW,
    );
    expect(html).toContain('unknown tier');
    expect(html).toContain('internal-only');
  });

  it('renders an em-dash when a row has no Rekor log indices', () => {
    const k = 'sha256:' + 'd'.repeat(64);
    const html = renderInternalBundlePage(
      'iec',
      k,
      [{ ...row({ tier: 'tier-1' }), bundleKey: k, rekorLogIndices: [] }],
      NOW,
    );
    // No rekor anchor link; em-dash placeholder instead.
    expect(html).not.toContain('logIndex=');
    expect(html).toContain('—');
  });
});

describe('internal URLs', () => {
  it('namespaces under /internal/results/ (distinct from public /results/)', () => {
    expect(internalRepoUrl('iec')).toBe('/internal/results/iec/');
    expect(internalBundleUrl('iec', 'sha256:' + 'a'.repeat(64))).toMatch(
      /^\/internal\/results\/iec\/sha256-a+\/$/,
    );
  });
});

describe('internal head + chrome (tailnet-only, never indexed)', () => {
  async function indexHtml() {
    const k = 'sha256:' + 'b'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([[k, [resolvedRow({ visibility: { tier: 'tier-2' } })]]]),
    );
    const view = await buildInternalResultsView(
      renderInput([repoState('iec', { bundleKeys: [k] })]),
      resolver,
    );
    return renderInternalIndex(view, buildInternalUse(view, NOW), NOW);
  }

  it('is noindex, nofollow and self-identifies as the operator/tailnet surface', async () => {
    const html = await indexHtml();
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).toContain('iep-view" content="operator-internal"');
    expect(html).toContain('iep-surface" content="tailnet-only"');
    // No public canonical link (so it can never be indexed even if it leaked).
    expect(html).not.toContain('rel="canonical"');
  });

  it('carries the loud operator banner explaining it is the inverse of public', async () => {
    const html = await indexHtml();
    expect(html).toContain('Operator-internal view (tailnet-only)');
    expect(html).toContain('inverse');
    expect(html).toContain('site-internal/');
  });

  it('passes the deploy HTML-sanity shape (DOCTYPE + closing tag + stylesheet)', async () => {
    const html = await indexHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<link rel="stylesheet" href="/style.css">');
  });
});

describe('internal per-repo + per-bundle pages', () => {
  it('repo page links back to the internal index and shows the operator banner', async () => {
    const k = 'sha256:' + 'e'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([[k, [resolvedRow({ visibility: { tier: 'tier-3' } })]]]),
    );
    const view = await buildInternalResultsView(
      renderInput([repoState('iec', { bundleKeys: [k] })]),
      resolver,
    );
    const repo = view.repos[0];
    if (repo === undefined) throw new Error('expected one repo');
    const html = renderInternalRepoPage(view, repo, NOW);
    expect(html).toContain('href="/internal/results/"');
    expect(html).toContain('Operator-internal view (tailnet-only)');
    expect(html).toContain('case-by-case'); // the Tier-3 row is shown (not hidden)
  });

  it('bundle page renders the bundle key and the row regardless of tier', async () => {
    const k = 'sha256:' + 'f'.repeat(64);
    const html = renderInternalBundlePage(
      'iec',
      k,
      [
        {
          repo: 'iec',
          bundleKey: k,
          rowIndex: 0,
          predicateUri: 'https://evals.intentsolutions.io/gate-result/v1',
          decision: 'fail',
          gateName: 'arch-check',
          evaluatedAt: '2026-05-30T11:00:00.000Z',
          bundleCreatedAt: '2026-05-30T11:05:00.000Z',
          rekorLogIndices: [99],
          ingestedAt: '2026-05-30T11:10:00.000Z',
          visibility: { tier: 'tier-2' },
        },
      ],
      NOW,
    );
    expect(html).toContain(k);
    expect(html).toContain('arch-check');
    expect(html).toContain('no consent'); // internal-only badge present
  });

  it('bundle page with zero rows shows the loud no-data panel', () => {
    const html = renderInternalBundlePage('iec', 'sha256:' + '0'.repeat(64), [], NOW);
    expect(html).toContain('no-data');
  });

  it('shows a stale-since badge on the index AND the repo page when serving prior-good', async () => {
    const k = 'sha256:' + '5'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([[k, [resolvedRow({ visibility: { tier: 'tier-1' } })]]]),
    );
    const view = await buildInternalResultsView(
      renderInput([
        repoState('iec', { bundleKeys: [k], staleSince: '2026-05-29T00:00:00.000Z' }),
      ]),
      resolver,
    );
    const indexHtml = renderInternalIndex(view, buildInternalUse(view, NOW), NOW);
    expect(indexHtml).toContain('stale since 2026-05-29T00:00:00.000Z');

    const repo = view.repos[0];
    if (repo === undefined) throw new Error('expected one repo');
    const repoHtml = renderInternalRepoPage(view, repo, NOW);
    expect(repoHtml).toContain('stale since 2026-05-29T00:00:00.000Z');
  });
});
