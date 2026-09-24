/**
 * Freshness-strip + /status HTML render tests (puxu.7).
 *
 * Asserts the rendered HTML carries the bindings VISUALLY:
 *   - no-data cells remain visible and distinct from confirmed failures;
 *   - the 25h-silent worker's recent cells carry `bucket--no-data` in the HTML
 *     (the binding is provable end-to-end, not just in the model);
 *   - the generated output is C3-clean (no cross-predicate aggregate PASS%);
 *   - the /status page renders the U/S/E numbers.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFreshnessStrip, type FreshnessRowInput } from './bucket-model.js';
import { computeIngestUse, type RepoLiveness, type SupervisionPressure } from './use-model.js';
import { renderFreshnessStrip, renderStatusPage } from './render-strip.js';
import { scanForAggregatePass } from '../results/c3-scan.js';

const REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp', 'jrig', 'qmd'] as const;
const NOW = '2026-06-04T12:30:00.000Z';
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (h: number): string => new Date(Date.parse(NOW) - h * HOUR_MS).toISOString();

const PRESSURE: SupervisionPressure = {
  restartCount: 0,
  restartBudget: 24,
  escalatedChildIds: [],
};

describe('renderFreshnessStrip — missing results are explicit, not failures', () => {
  it('empty state labels all 192 unknown cells without inventing outcomes', () => {
    const view = buildFreshnessStrip(REPOS, [], NOW);
    const html = renderFreshnessStrip(view);
    // 8 repos × 24 buckets = 192 explicit no-data table cells. Count only the
    // <td> cells (the legend swatch also uses the no-data class but is a <span>).
    const noDataCells = html.match(/<td class="bucket bucket--no-data"/g) ?? [];
    expect(noDataCells.length).toBe(8 * 24);
    // Whole-window absence is clearly labeled too.
    expect(html).toContain('badge badge--no-data');
    expect(html).toContain('Their test outcomes are unknown');
    expect(html).toContain('No result is not a failed test');
    expect(html).toContain('No result (unknown)');
    expect(html).not.toContain('equal to fail');
    expect(html).not.toContain('rolling out upstream');
    expect(html).not.toMatch(/<td class="bucket bucket--(pass|fail)"/);
  });

  it('missing-result cells, badges and panels have their own outlined non-red CSS', () => {
    const css = readFileSync(new URL('../../site/style.css', import.meta.url), 'utf8');
    const rule = (selector: string): string =>
      new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`).exec(css)?.[1] ?? '';
    const background = (selector: string): string =>
      /background:\s*([^;]+);/.exec(rule(selector))?.[1] ?? '';
    for (const selector of ['bucket--no-data', 'badge--no-data', 'no-data-panel']) {
      expect(rule(selector)).toContain('dashed');
      expect(background(selector)).not.toBe('');
      expect(background(selector)).not.toBe(background('bucket--fail'));
      expect(background(selector)).not.toBe(background('bucket--pass'));
      expect(background(selector)).not.toBe(background('bucket--error'));
    }
    expect(rule('bucket--fail')).toContain('#fee2e2');
    expect(rule('badge--result-fail')).toContain('#fee2e2');
  });

  it('a fail hour renders a bucket--fail cell', () => {
    const rows: FreshnessRowInput[] = [{ repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'fail' }];
    const html = renderFreshnessStrip(buildFreshnessStrip(REPOS, rows, NOW));
    expect(html).toContain('bucket bucket--fail');
  });

  it('screen-reader descriptions include the hour and full outcome counts', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'pass' },
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'fail' },
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'error' },
    ];
    const html = renderFreshnessStrip(buildFreshnessStrip(REPOS, rows, NOW));
    expect(html).toMatch(/class="sr-only">2026-06-04T11:00:00.000Z — pass: 1 · fail: 1 · error: 1/);
    expect(html).toMatch(
      /class="sr-only">[^<]+The test outcome is unknown, not a pass or a failure/,
    );
  });

  it('a quiet hour reports the last result without implying it is overdue', () => {
    const rows: FreshnessRowInput[] = [{ repo: 'iec', evaluatedAt: hoursAgo(5), decision: 'pass' }];
    const html = renderFreshnessStrip(buildFreshnessStrip(REPOS, rows, NOW));
    expect(html).toContain(`datetime="${hoursAgo(5)}"`);
    expect(html).toContain('Last result:');
    expect(html).not.toContain('badge--stale');
    expect(html).toContain('tests may run daily or only when something changes');
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
    { repo: 'jrig', fresh: false },
    { repo: 'qmd', fresh: false },
  ];

  it('renders a valid self-contained page with U/S/E and the strip', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(liveness, PRESSURE, strip, NOW);
    const html = renderStatusPage(use, strip);

    // self-contained doc (deploy HTML sanity gate)
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<link rel="stylesheet" href="/style.css">');

    // Utilization: 2/8 fresh
    expect(html).toContain('Utilization');
    expect(html).toMatch(/<strong>2<\/strong>\s*\/\s*8 workers/);
    // Saturation card
    expect(html).toContain('Saturation');
    // Errors: 1 crash with structured reason
    expect(html).toContain('Collection failures');
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
      { restartCount: 3, restartBudget: 24, escalatedChildIds: ['ingest_worker:iaj'] },
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

  it.each([
    {
      name: 'successful collection with no published tests',
      liveness: REPOS.map((repo) => ({ repo, fresh: true })),
      pressure: PRESSURE,
      now: NOW,
      state: 'complete',
      title: 'Data collection completed',
    },
    {
      name: 'no workers reported',
      liveness: [],
      pressure: PRESSURE,
      now: NOW,
      state: 'unknown',
      title: 'No collection status available',
    },
    {
      name: 'invalid snapshot clock',
      liveness: [{ repo: 'iec', fresh: true }],
      pressure: PRESSURE,
      now: 'invalid-clock',
      state: 'unknown',
      title: 'No collection status available',
    },
    {
      name: 'incomplete source checks',
      liveness: [{ repo: 'iec', fresh: false }],
      pressure: PRESSURE,
      now: NOW,
      state: 'warning',
      title: 'Some source checks need attention',
    },
    {
      name: 'stale snapshot',
      liveness: [{ repo: 'iec', fresh: true, staleSince: hoursAgo(3) }],
      pressure: PRESSURE,
      now: NOW,
      state: 'warning',
      title: 'Some source checks need attention',
    },
    {
      name: 'successful collection with retries',
      liveness: [{ repo: 'iec', fresh: true }],
      pressure: { ...PRESSURE, restartCount: 1 },
      now: NOW,
      state: 'warning',
      title: 'Data collection completed with retries',
    },
    {
      name: 'verification failure',
      liveness: [
        {
          repo: 'iec',
          fresh: false,
          failure: { step: 'verify_dsse', reasonCode: 'bad_signature' },
        },
      ],
      pressure: PRESSURE,
      now: NOW,
      state: 'error',
      title: 'Data collection needs attention',
    },
    {
      name: 'supervisor escalation',
      liveness: [{ repo: 'iec', fresh: true }],
      pressure: { ...PRESSURE, escalatedChildIds: ['iec'] },
      now: NOW,
      state: 'error',
      title: 'Data collection needs attention',
    },
  ])('separates snapshot collection state: $name', ({ liveness, pressure, now, state, title }) => {
    const strip = buildFreshnessStrip(REPOS, [], now);
    const use = computeIngestUse(liveness, pressure, strip, now);
    const html = renderStatusPage(use, strip);
    expect(html).toContain(`collection-summary--${state}`);
    expect(html).toContain(title);
    expect(html).toContain('not whether the tested skills passed');
    expect(html).toContain('not live monitoring');
    expect(html).toContain('No verified test results in this window');
    expect(html).not.toMatch(/<td class="bucket bucket--(pass|fail)"/);
  });

  it('successful source collection never masks failed or errored evaluations', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'fail' },
      { repo: 'iel', evaluatedAt: hoursAgo(1), decision: 'error' },
    ];
    const strip = buildFreshnessStrip(REPOS, rows, NOW);
    const use = computeIngestUse(
      REPOS.map((repo) => ({ repo, fresh: true })),
      PRESSURE,
      strip,
      NOW,
    );
    const html = renderStatusPage(use, strip);
    expect(html).toContain('collection-summary--complete');
    expect(html).toMatch(/<td class="bucket bucket--fail"/);
    expect(html).toMatch(/<td class="bucket bucket--error"/);
  });

  it('unmeasured retries never render a fabricated zero or a retry warning', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(
      [{ repo: 'iec', fresh: true }],
      { ...PRESSURE, measured: false, restartCount: 12 },
      strip,
      NOW,
    );
    const html = renderStatusPage(use, strip);
    expect(html).toContain('<strong>Not recorded</strong>');
    expect(html).toContain('No retry count is available');
    expect(html).not.toContain('12</strong> restarts');
    expect(html).not.toContain('0</strong> restarts');
    expect(html).toContain('collection-summary--complete');
  });

  it('reports all sources with results without a missing-results warning', () => {
    const strip = buildFreshnessStrip(
      ['iec'],
      [{ repo: 'iec', evaluatedAt: hoursAgo(0.2), decision: 'pass' }],
      NOW,
    );
    const use = computeIngestUse([{ repo: 'iec', fresh: true }], PRESSURE, strip, NOW);
    const html = renderStatusPage(use, strip);
    expect(html).toContain('Every source has at least one verified test result');
    expect(html).not.toContain('No verified test results in this window');
  });
});
