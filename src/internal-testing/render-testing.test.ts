/**
 * Render tests for the gated testing dashboard.
 *
 * Proves the guided-tour shape (explainer + data + verdict + measured + fix),
 * the gated-surface markers (noindex, basicauth-gated, never tailnet-only), the
 * loud no-data state, and structural C3-cleanliness of the rendered output.
 */

import { describe, expect, it } from 'vitest';
import { scanForAggregatePass } from '../results/c3-scan.js';
import {
  pathFromTestingUrl,
  renderTestingIndex,
  renderTestingRepoPage,
  testingRepoUrl,
  verdictBadge,
} from './render-testing.js';
import { deriveVerdict } from './verdict.js';
import { type TestingRepo, type TestingView } from './testing-row.js';
import { explainerSet, testingRow } from './__fixtures__/testing-fixtures.js';

const EXPLAINERS = explainerSet([
  { key: 'coverage', title: 'Coverage', html: '            <h2>What it is</h2>\n            <p>Lines run.</p>' },
  { key: 'gate-result', title: 'Gate result', html: '            <p>Generic explainer.</p>' },
  { key: '_index', title: 'How to read', html: '            <p>Read it like a tour.</p>' },
]);

/** A repo with a passing coverage gate, a failing CRAP gate, and an unexplained gate. */
function richRepo(): TestingRepo {
  return {
    repo: 'iec',
    noData: false,
    ingestedAt: '2026-05-30T12:00:05.000Z',
    rows: [
      testingRow({ gateName: 'coverage', decision: 'pass', rekorLogIndices: [424242] }),
      testingRow({
        gateName: 'crap',
        decision: 'fail',
        failureMode: 'MM-2',
        gateReasons: ['parse() CRAP 41 > 30'],
        coverage: { dimensionsEvaluated: ['complexity'], dimensionsSkipped: ['coverage'] },
        rekorLogIndices: [],
        rowIndex: 1,
      }),
      testingRow({ gateName: 'bespoke-gate', decision: 'advisory', advisorySeverity: 'info', gateReasons: ['heads up'] }),
    ],
  };
}

function viewOf(repos: readonly TestingRepo[], asOf?: string): TestingView {
  return { ...(asOf !== undefined ? { asOf } : {}), repos };
}

describe('renderTestingRepoPage — guided tour shape', () => {
  const html = renderTestingRepoPage(viewOf([richRepo()], '2026-05-30T12:00:05.000Z'), richRepo(), EXPLAINERS);

  it('is a self-contained, NON-indexed, gated page', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<link rel="stylesheet" href="/style.css">');
    expect(html).toContain('noindex, nofollow');
    expect(html).toContain('content="basicauth-gated"');
    // It must NOT claim to be the tailnet-only operator surface.
    expect(html).not.toContain('tailnet-only');
  });

  it('shows the authored explainer for a known gate, once', () => {
    expect(html).toContain('<h2><code>coverage</code></h2>');
    expect(html).toContain('Lines run.');
  });

  it('shows the generic explainer fallback for a gate without its own', () => {
    expect(html).toContain('<h2><code>bespoke-gate</code></h2>');
    expect(html).toContain('Generic explainer.');
  });

  it('renders the verdict + decision + what-to-fix for a failing gate', () => {
    expect(html).toContain('verdict--fail');
    expect(html).toContain('[failure mode: MM-2]');
    expect(html).toContain('parse() CRAP 41 &gt; 30'); // escaped
    expect(html).toContain('What to fix:');
  });

  it('renders the coverage measured + skipped block', () => {
    expect(html).toContain('What we measured:');
    expect(html).toContain('Not measured (skipped):');
    expect(html).toContain('<code>complexity</code>');
  });

  it('shows "nothing to fix" for a passing gate and a Rekor anchor link', () => {
    expect(html).toContain('Nothing to fix');
    expect(html).toContain('logIndex=424242');
  });

  it('orders the failing gate before the passing gate (loudest first)', () => {
    expect(html.indexOf('<code>crap</code>')).toBeLessThan(html.indexOf('<code>coverage</code>'));
  });

  it('is structurally C3-clean (no cross-predicate aggregate PASS%)', () => {
    expect(scanForAggregatePass(html)).toEqual([]);
  });
});

describe('renderTestingRepoPage — edge states', () => {
  it('renders a loud no-data panel for an empty repo', () => {
    const repo: TestingRepo = { repo: 'iah', noData: true, rows: [] };
    const html = renderTestingRepoPage(viewOf([repo]), repo, EXPLAINERS);
    expect(html).toContain('no-data');
    expect(html).toContain('No data is not a pass');
  });

  it('renders a stale badge when serving a prior-good snapshot', () => {
    const repo: TestingRepo = {
      repo: 'iel',
      noData: false,
      staleSince: '2026-05-29T00:00:00.000Z',
      rows: [testingRow({ gateName: 'coverage' })],
    };
    const html = renderTestingRepoPage(viewOf([repo]), repo, EXPLAINERS);
    expect(html).toContain('stale since 2026-05-29T00:00:00.000Z');
  });

  it('shows "no explainer authored" when even the generic is absent', () => {
    const repo: TestingRepo = { repo: 'iec', noData: false, rows: [testingRow({ gateName: 'mystery' })] };
    const html = renderTestingRepoPage(viewOf([repo]), repo, explainerSet([])); // empty set
    expect(html).toContain('No explainer authored yet');
  });

  it('renders an inert, escaped Rekor link for a non-integer index (type-hole defence)', () => {
    // A malformed resolver could slip a non-number through; it must not break out
    // of the href attribute or the <code> text.
    const repo: TestingRepo = {
      repo: 'iec',
      noData: false,
      rows: [
        testingRow({
          gateName: 'coverage',
          rekorLogIndices: ['"onload="alert(1)' as unknown as number, -5],
        }),
      ],
    };
    const html = renderTestingRepoPage(viewOf([repo]), repo, EXPLAINERS);
    expect(html).toContain('href="#"'); // bad value → inert link, not a real URL
    expect(html).not.toContain('logIndex="onload'); // never reaches the URL
    expect(html).not.toContain('onload="alert'); // never escapes the attribute
    expect(html).toContain('&quot;onload='); // shown as escaped text only
  });
});

describe('renderTestingIndex', () => {
  it('renders the how-to-read explainer + a per-repo summary with worst verdict', () => {
    const view = viewOf(
      [
        richRepo(),
        { repo: 'iah', noData: true, rows: [] },
      ],
      '2026-05-30T12:00:05.000Z',
    );
    const html = renderTestingIndex(view, EXPLAINERS);
    expect(html).toContain('Read it like a tour.');
    expect(html).toContain('Internal testing dashboard');
    // iec has a failing gate → worst verdict is fail.
    expect(html).toContain('verdict--fail');
    // iah is no-data.
    expect(html).toContain('no-data');
    // As-of present.
    expect(html).toContain('2026-05-30T12:00:05.000Z');
  });

  it('renders the as-of-none banner + omits how-to when the index explainer is absent', () => {
    const view = viewOf([{ repo: 'iec', noData: true, rows: [] }]);
    const html = renderTestingIndex(view, explainerSet([])); // no _index doc
    expect(html).toContain('no source has a verified snapshot yet');
    expect(html).not.toContain('how-to-read');
  });
});

describe('url + badge helpers', () => {
  it('testingRepoUrl + pathFromTestingUrl round-trip to a file path', () => {
    expect(testingRepoUrl('iec')).toBe('/internal/testing/iec/');
    expect(pathFromTestingUrl(testingRepoUrl('iec'))).toBe('internal/testing/iec/index.html');
    expect(pathFromTestingUrl('/internal/testing/')).toBe('internal/testing/index.html');
  });

  it('verdictBadge carries the kind class + a decorative glyph', () => {
    const badge = verdictBadge(deriveVerdict(testingRow({ decision: 'pass' })));
    expect(badge).toContain('verdict--good');
    expect(badge).toContain('aria-hidden="true"');
  });
});
