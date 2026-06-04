/**
 * Freshness bucket-model tests (puxu.7 / Epic 2.4).
 *
 * The load-bearing test is the SYNTHETIC 25h-silent worker (DR-035 C4 / Gregg):
 * a worker that last produced verified rows 25 hours ago must show the `no-data`
 * kind across the recent bucket(s) — proving the "never silently filled" binding
 * holds (NOT carried forward from the >24h-old data, NOT blank).
 *
 * Plus: the strip is exactly 6 rows × 24 buckets; bucket color = the correct
 * decision-mix kind; out-of-window + unparseable rows are dropped (holes, not
 * passes); the most-severe-decision coloring rule.
 */

import { describe, expect, it } from 'vitest';
import { BUCKET_COUNT, buildFreshnessStrip, type FreshnessRowInput } from './bucket-model.js';

const REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;
const NOW = '2026-06-04T12:30:00.000Z';
const HOUR_MS = 60 * 60 * 1000;

/** ISO timestamp `h` hours before NOW. */
function hoursAgo(h: number): string {
  return new Date(Date.parse(NOW) - h * HOUR_MS).toISOString();
}

describe('buildFreshnessStrip — shape', () => {
  it('renders exactly 6 rows × 24 buckets', () => {
    const view = buildFreshnessStrip(REPOS, [], NOW);
    expect(view.rows).toHaveLength(6);
    for (const row of view.rows) {
      expect(row.buckets).toHaveLength(BUCKET_COUNT);
    }
  });

  it('preserves repo order', () => {
    const view = buildFreshnessStrip(REPOS, [], NOW);
    expect(view.rows.map((r) => r.repo)).toEqual([...REPOS]);
  });

  it('the right-most bucket is the hour containing now', () => {
    const view = buildFreshnessStrip(REPOS, [], NOW);
    const last = view.rows[0]?.buckets[BUCKET_COUNT - 1];
    expect(last?.hourStartIso).toBe('2026-06-04T12:00:00.000Z');
  });
});

describe('buildFreshnessStrip — empty / current state is loud no-data', () => {
  it('every repo with no rows yields 24 no-data buckets', () => {
    const view = buildFreshnessStrip(REPOS, [], NOW);
    for (const row of view.rows) {
      expect(row.allNoData).toBe(true);
      for (const b of row.buckets) {
        expect(b.kind).toBe('no-data');
        expect(b.total).toBe(0);
      }
    }
  });
});

describe('buildFreshnessStrip — decision-mix coloring', () => {
  it('an hour with only passes colors the bucket pass', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'pass' },
      { repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'pass' },
    ];
    const view = buildFreshnessStrip(REPOS, rows, NOW);
    const iec = view.rows.find((r) => r.repo === 'iec');
    const recent = iec?.buckets[BUCKET_COUNT - 2]; // ~1h ago
    expect(recent?.kind).toBe('pass');
    expect(recent?.counts.pass).toBe(2);
    expect(recent?.total).toBe(2);
  });

  it('a single fail in an hour colors the hour fail even with passes present', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'iah', evaluatedAt: hoursAgo(2), decision: 'pass' },
      { repo: 'iah', evaluatedAt: hoursAgo(2), decision: 'pass' },
      { repo: 'iah', evaluatedAt: hoursAgo(2), decision: 'fail' },
    ];
    const view = buildFreshnessStrip(REPOS, rows, NOW);
    const bucket = view.rows.find((r) => r.repo === 'iah')?.buckets[BUCKET_COUNT - 3];
    expect(bucket?.kind).toBe('fail');
    expect(bucket?.counts.fail).toBe(1);
    expect(bucket?.counts.pass).toBe(2);
  });

  it('severity precedence fail > error > advisory > pass', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'iel', evaluatedAt: hoursAgo(3), decision: 'advisory' },
      { repo: 'iel', evaluatedAt: hoursAgo(3), decision: 'error' },
    ];
    const view = buildFreshnessStrip(REPOS, rows, NOW);
    const bucket = view.rows.find((r) => r.repo === 'iel')?.buckets[BUCKET_COUNT - 4];
    // error outranks advisory; no fail present.
    expect(bucket?.kind).toBe('error');
  });
});

describe('buildFreshnessStrip — window boundaries', () => {
  it('drops rows older than the 24h window (treated as a hole, not a pass)', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'iar', evaluatedAt: hoursAgo(48), decision: 'pass' },
    ];
    const view = buildFreshnessStrip(REPOS, rows, NOW);
    const iar = view.rows.find((r) => r.repo === 'iar');
    expect(iar?.allNoData).toBe(true);
    for (const b of iar?.buckets ?? []) expect(b.kind).toBe('no-data');
  });

  it('drops rows with an unparseable timestamp (hole, not a pass)', () => {
    const rows: FreshnessRowInput[] = [
      { repo: 'ccp', evaluatedAt: 'not-a-date', decision: 'pass' },
    ];
    const view = buildFreshnessStrip(REPOS, rows, NOW);
    expect(view.rows.find((r) => r.repo === 'ccp')?.allNoData).toBe(true);
  });

  it('fail-closed on an unparseable now: every real row falls outside ⇒ all no-data', () => {
    const rows: FreshnessRowInput[] = [{ repo: 'iec', evaluatedAt: hoursAgo(1), decision: 'pass' }];
    const view = buildFreshnessStrip(REPOS, rows, 'broken-clock');
    for (const row of view.rows) expect(row.allNoData).toBe(true);
  });
});

/* ── THE LOAD-BEARING TEST: 25h-silent worker, never silently filled ── */
describe('buildFreshnessStrip — 25h-silent worker (DR-035 C4 binding)', () => {
  it('a worker silent for 25h shows no-data across the recent bucket(s), NOT back-filled', () => {
    // `iaj` produced healthy PASS rows 25 hours ago, then went silent. Every
    // OTHER repo has fresh data this hour (so the page is not trivially empty).
    const rows: FreshnessRowInput[] = [
      // iaj's last verified activity: 25h ago — OUTSIDE the 24h window.
      { repo: 'iaj', evaluatedAt: hoursAgo(25), decision: 'pass' },
      { repo: 'iaj', evaluatedAt: hoursAgo(25), decision: 'pass' },
      // Other repos: fresh this hour.
      { repo: 'iec', evaluatedAt: hoursAgo(0.2), decision: 'pass' },
      { repo: 'iel', evaluatedAt: hoursAgo(0.2), decision: 'pass' },
    ];
    const view = buildFreshnessStrip(REPOS, rows, NOW);

    const iaj = view.rows.find((r) => r.repo === 'iaj');
    expect(iaj).toBeDefined();

    // 1. The most-recent bucket is no-data (not back-filled with the 25h-old pass).
    const recent = iaj?.buckets[BUCKET_COUNT - 1];
    expect(recent?.kind).toBe('no-data');
    expect(recent?.total).toBe(0);

    // 2. EVERY bucket in the window is no-data — the 25h-old pass is outside it
    //    and is NOT carried forward into any in-window hour.
    expect(iaj?.allNoData).toBe(true);
    for (const b of iaj?.buckets ?? []) {
      expect(b.kind).toBe('no-data');
      expect(b.counts.pass).toBe(0); // crucially: NOT filled with the prior pass
      expect(b.total).toBe(0);
    }

    // 3. The 25h-old pass is NOT used to fill a bucket, but the repo's window has
    //    no in-window row at all ⇒ no "last verified" annotation inside window.
    expect(iaj?.lastSeenInWindowIso).toBeUndefined();

    // 4. The fresh repos are NOT no-data — proving the silence is specific to iaj.
    expect(view.rows.find((r) => r.repo === 'iec')?.allNoData).toBe(false);
    expect(view.rows.find((r) => r.repo === 'iel')?.allNoData).toBe(false);
  });

  it('a worker whose LAST in-window row was >1h ago shows no-data recent + a lastSeen annotation', () => {
    // iah had a pass 5h ago (in window) but nothing since ⇒ recent bucket is
    // no-data, and lastSeen reflects the 5h-old row (descriptive, not a fill).
    const fiveHToTop = new Date(
      Math.floor((Date.parse(NOW) - 5 * HOUR_MS) / HOUR_MS) * HOUR_MS + 10 * 60 * 1000,
    ).toISOString();
    const rows: FreshnessRowInput[] = [{ repo: 'iah', evaluatedAt: fiveHToTop, decision: 'pass' }];
    const view = buildFreshnessStrip(REPOS, rows, NOW);
    const iah = view.rows.find((r) => r.repo === 'iah');
    // recent bucket is no-data
    expect(iah?.buckets[BUCKET_COUNT - 1]?.kind).toBe('no-data');
    // but not the WHOLE row — the 5h-old bucket carries the pass
    expect(iah?.allNoData).toBe(false);
    // lastSeen annotation present (recent is no-data, an in-window row exists)
    expect(iah?.lastSeenInWindowIso).toBe(fiveHToTop);
  });
});
