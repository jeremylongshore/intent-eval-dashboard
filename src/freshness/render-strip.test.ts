/**
 * Freshness-strip + /status HTML render tests (puxu.7).
 *
 * Asserts the rendered HTML carries the bindings VISUALLY:
 *   - no-data cells use the loud `bucket--no-data` class (equal weight to fail);
 *   - the 25h-silent worker's recent cells carry `bucket--no-data` in the HTML
 *     (the binding is provable end-to-end, not just in the model);
 *   - the generated output is C3-clean (no cross-predicate aggregate PASS%);
 *   - the /status page renders the U/S/E numbers.
 */

import { describe, expect, it } from 'vitest';
import { buildFreshnessStrip, type FreshnessRowInput } from './bucket-model.js';
import { computeIngestUse, type RepoLiveness, type SupervisionPressure } from './use-model.js';
import { renderFreshnessStrip, renderStatusPage } from './render-strip.js';
import { scanForAggregatePass } from '../results/c3-scan.js';

const REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;
const NOW = '2026-06-04T12:30:00.000Z';
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (h: number): string => new Date(Date.parse(NOW) - h * HOUR_MS).toISOString();

const PRESSURE: SupervisionPressure = {
  restartCount: 0,
  restartBudget: 18,
  escalatedChildIds: [],
};

describe('renderFreshnessStrip — no-data is loud (equal to fail)', () => {
  it('empty (current state) renders every cell with the loud bucket--no-data class', () => {
    const view = buildFreshnessStrip(REPOS, [], NOW);
    const html = renderFreshnessStrip(view);
    // 6 repos × 24 buckets = 144 no-data table cells, all loud. Count only the
    // <td> cells (the legend swatch also uses the no-data class but is a <span>).
    const noDataCells = html.match(/<td class="bucket bucket--no-data"/g) ?? [];
    expect(noDataCells.length).toBe(6 * 24);
    // The loud no-data badge for fully-silent rows appears too.
    expect(html).toContain('badge badge--no-data');
    // The honest-state note is present (we render silence loudly, never fill it).
    expect(html).toContain('honest current state');
  });

  it('no-data and fail share the same CSS class family (no neutral/blank state)', () => {
    const view = buildFreshnessStrip(REPOS, [], NOW);
    const html = renderFreshnessStrip(view);
    // there is no "neutral"/"empty"/"blank" bucket class — only the kinds.
    expect(html).not.toMatch(/bucket--(neutral|empty|blank|unknown)/);
  });

  it('a fail hour renders a bucket--fail cell', () => {
    const rows: FreshnessRowInput[] = [{ repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'fail' }];
    const html = renderFreshnessStrip(buildFreshnessStrip(REPOS, rows, NOW));
    expect(html).toContain('bucket bucket--fail');
  });
});

describe('renderFreshnessStrip — 25h-silent worker is loud no-data in the HTML', () => {
  it('the silent repo row renders only no-data cells (never back-filled with the 25h-old pass)', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'iaj', evaluatedAt: hoursAgo(25), decision: 'pass' }, // outside window
      { repo: 'iec', evaluatedAt: hoursAgo(0.2), decision: 'pass' }, // fresh
    ];
    const view = buildFreshnessStrip(REPOS, rows, NOW);
    const html = renderFreshnessStrip(view);

    // Extract iaj's table row and assert it contains NO pass cell at all.
    const iajRowRe = /<th scope="row"[^>]*><a href="\/results\/iaj\/">[\s\S]*?<\/tr>/;
    const iajRowMatch = iajRowRe.exec(html);
    expect(iajRowMatch).not.toBeNull();
    const iajRow = iajRowMatch?.[0] ?? '';
    expect(iajRow).toContain('bucket--no-data');
    expect(iajRow).not.toContain('bucket--pass'); // the 25h-old pass is NOT rendered
    // iaj is flagged as fully silent in the row header.
    expect(iajRow).toContain('badge badge--no-data');

    // iec (fresh) DOES have a pass cell — proving the silence is iaj-specific.
    const iecRowRe = /<th scope="row"[^>]*><a href="\/results\/iec\/">[\s\S]*?<\/tr>/;
    const iecRowMatch = iecRowRe.exec(html);
    expect(iecRowMatch?.[0] ?? '').toContain('bucket--pass');
  });
});

describe('renderFreshnessStrip — C3 clean (no aggregate PASS%)', () => {
  it('strip output trips no C3 violation (no predicate URIs, no X/N pass token)', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'pass' },
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'fail' },
      { repo: 'iel', evaluatedAt: hoursAgo(2), decision: 'advisory' },
    ];
    const html = renderFreshnessStrip(buildFreshnessStrip(REPOS, rows, NOW));
    expect(scanForAggregatePass(html)).toEqual([]);
    // Defence in depth: the strip never references a predicate URI at all.
    expect(html).not.toContain('evals.intentsolutions.io');
  });
});

describe('renderStatusPage — USE method', () => {
  const liveness: RepoLiveness[] = [
    { repo: 'iec', fresh: true },
    { repo: 'iel', fresh: true },
    { repo: 'iah', fresh: false, staleSince: hoursAgo(3) },
    {
      repo: 'iaj',
      fresh: false,
      failure: { step: 'verify_rekor', reasonCode: 'no_inclusion_proof' },
    },
    { repo: 'iar', fresh: false },
    { repo: 'ccp', fresh: false },
  ];

  it('renders a valid self-contained page with U/S/E and the strip', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(liveness, PRESSURE, strip, NOW);
    const html = renderStatusPage(use, strip);

    // self-contained doc (deploy HTML sanity gate)
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<link rel="stylesheet" href="/style.css">');

    // Utilization: 2/6 fresh
    expect(html).toContain('Utilization');
    expect(html).toMatch(/<strong>2<\/strong>\s*\/\s*6 workers/);
    // Saturation card
    expect(html).toContain('Saturation');
    // Errors: 1 crash with structured reason
    expect(html).toContain('Errors');
    expect(html).toContain('verify_rekor');
    expect(html).toContain('no_inclusion_proof');
    // the embedded strip
    expect(html).toContain('freshness-strip-grid');
  });

  it('a crash flips the Errors card to the alarm (loud) treatment', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(liveness, PRESSURE, strip, NOW);
    const html = renderStatusPage(use, strip);
    expect(html).toContain('use-card--alarm');
  });

  it('escalation renders the alarm saturation card', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(
      liveness,
      { restartCount: 3, restartBudget: 18, escalatedChildIds: ['ingest_worker:iaj'] },
      strip,
      NOW,
    );
    const html = renderStatusPage(use, strip);
    expect(html).toContain('Escalated (supervisor gave up)');
  });

  it('status page is C3-clean', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(liveness, PRESSURE, strip, NOW);
    expect(scanForAggregatePass(renderStatusPage(use, strip))).toEqual([]);
  });
});
