/**
 * Alert-evaluator tests (puxu.11).
 *
 * Proves the ONE hard binding: 7-day-silence is the ONLY paging trigger, with a
 * precisely-tested boundary at exactly 7 days, and proves nothing else (errors,
 * freshness within the window) ever flips the gate. All times are injected — no
 * wall clock anywhere.
 */

import { describe, expect, it } from 'vitest';
import { evaluateLivenessAlerts, SEVEN_DAYS_MS, type SourceLiveness } from './evaluate.js';

const NOW = '2026-06-04T12:00:00.000Z';
const nowMs = Date.parse(NOW);
const MS_PER_HOUR = 60 * 60 * 1000;
const at = (msBeforeNow: number): string => new Date(nowMs - msBeforeNow).toISOString();

describe('evaluateLivenessAlerts — 7d-silence is the only paging trigger', () => {
  it('synthetic stale-7d: a source last-ingested 7d+1h ago pages (critical)', () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iaj', lastSuccessfulIngestIso: at(SEVEN_DAYS_MS + MS_PER_HOUR) },
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(1);
    expect(out.critical[0]?.repo).toBe('iaj');
    // 7d + 1h silence ⇒ daysSilent floors to 7.
    expect(out.critical[0]?.daysSilent).toBe(7);
  });

  it('synthetic fresh-6d: a source ingested 6 days ago does NOT page', () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iec', lastSuccessfulIngestIso: at(6 * 24 * MS_PER_HOUR) },
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(0);
  });

  it('BOUNDARY: exactly 7 days silent does NOT page (the last non-paging state)', () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iel', lastSuccessfulIngestIso: at(SEVEN_DAYS_MS) },
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(0);
  });

  it('BOUNDARY: 7 days + 1 millisecond silent DOES page', () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iel', lastSuccessfulIngestIso: at(SEVEN_DAYS_MS + 1) },
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(1);
    expect(out.critical[0]?.repo).toBe('iel');
  });

  it('a source that has NEVER been seen pages (infinitely silent)', () => {
    const liveness: SourceLiveness[] = [{ repo: 'iar' }];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(1);
    expect(out.critical[0]?.repo).toBe('iar');
    expect(out.critical[0]?.silentMs).toBe(Number.POSITIVE_INFINITY);
    expect(out.critical[0]?.daysSilent).toBe(Number.POSITIVE_INFINITY);
    expect(out.critical[0]?.lastSuccessfulIngestIso).toBeUndefined();
  });
});

describe('evaluateLivenessAlerts — ONLY-trigger proof (nothing else pages)', () => {
  it('a source with a CURRENT error but a FRESH ingest does NOT page', () => {
    // Erroring its head off — but last successful ingest is 1 hour ago.
    const liveness: SourceLiveness[] = [
      {
        repo: 'iah',
        lastSuccessfulIngestIso: at(MS_PER_HOUR),
        currentError: { step: 'verify-rekor', reasonCode: 'REKOR_INCLUSION_FAILED' },
      },
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(0); // an error never flips the gate
  });

  it('the SAME error WITH 7d+ silence still pages — but because of silence, not the error', () => {
    const liveness: SourceLiveness[] = [
      {
        repo: 'iah',
        lastSuccessfulIngestIso: at(SEVEN_DAYS_MS + MS_PER_HOUR),
        currentError: { step: 'verify-rekor', reasonCode: 'REKOR_INCLUSION_FAILED' },
      },
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(1);
    expect(out.critical[0]?.repo).toBe('iah');
  });

  it('a busy mix: only the silent>7d sources page; fresh/erroring/6d sources do not', () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iec', lastSuccessfulIngestIso: at(MS_PER_HOUR) }, // fresh
      { repo: 'iel', lastSuccessfulIngestIso: at(6 * 24 * MS_PER_HOUR) }, // 6d
      {
        repo: 'iah',
        lastSuccessfulIngestIso: at(2 * MS_PER_HOUR),
        currentError: { step: 'verify-dsse', reasonCode: 'DSSE_BAD_SIG' },
      }, // fresh + erroring
      { repo: 'iaj', lastSuccessfulIngestIso: at(SEVEN_DAYS_MS + 5 * MS_PER_HOUR) }, // silent
      { repo: 'iar' }, // never seen
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    const paged = out.critical.map((c) => c.repo);
    expect(paged).toContain('iaj');
    expect(paged).toContain('iar');
    expect(paged).not.toContain('iec');
    expect(paged).not.toContain('iel');
    expect(paged).not.toContain('iah');
    expect(out.critical).toHaveLength(2);
  });

  it('sorts most-silent first (never-seen at the top)', () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iaj', lastSuccessfulIngestIso: at(SEVEN_DAYS_MS + MS_PER_HOUR) }, // 7d1h
      { repo: 'iar' }, // infinite
      { repo: 'iel', lastSuccessfulIngestIso: at(SEVEN_DAYS_MS + 10 * MS_PER_HOUR) }, // 7d10h
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical.map((c) => c.repo)).toEqual(['iar', 'iel', 'iaj']);
  });

  it('empty liveness → no alerts', () => {
    expect(evaluateLivenessAlerts([], NOW).critical).toEqual([]);
  });
});

describe('evaluateLivenessAlerts — fail-closed clock + skew handling', () => {
  it('an unparseable last-ingest timestamp fails CLOSED to silent (pages)', () => {
    const liveness: SourceLiveness[] = [{ repo: 'iel', lastSuccessfulIngestIso: 'not-a-date' }];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(1);
    expect(out.critical[0]?.silentMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('a FUTURE last-ingest (clock skew) clamps silence to 0 and does NOT page', () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iec', lastSuccessfulIngestIso: new Date(nowMs + 5 * MS_PER_HOUR).toISOString() },
    ];
    const out = evaluateLivenessAlerts(liveness, NOW);
    expect(out.critical).toHaveLength(0);
  });

  it('an unparseable NOW anchors at epoch 0 → everything reads future-dated → NOTHING pages', () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iaj', lastSuccessfulIngestIso: at(SEVEN_DAYS_MS + MS_PER_HOUR) },
      { repo: 'iar' }, // never-seen still pages (Infinity > 7d regardless of now)
    ];
    const out = evaluateLivenessAlerts(liveness, 'broken-clock');
    // Real-dated source: nowMs=0 ⇒ silence clamps to 0 ⇒ no page.
    // Never-seen source: Infinity > 7d ⇒ still pages (honest: it is dark no matter the clock).
    expect(out.critical.map((c) => c.repo)).toEqual(['iar']);
  });
});
