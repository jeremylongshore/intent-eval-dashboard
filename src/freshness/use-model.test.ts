/**
 * USE-method (Utilization / Saturation / Errors) tests for the ingest pipeline.
 *
 * Proves the /status numbers compute correctly from pipeline state:
 *   - U = fresh workers / total (stale workers NOT counted as utilized);
 *   - S = restart pressure vs budget; escalation forces saturation high;
 *   - E = crash count with structured reasons preserved;
 *   - fully-silent repos derived from the 24h strip.
 */

import { describe, expect, it } from 'vitest';
import { buildFreshnessStrip, type FreshnessRowInput } from './bucket-model.js';
import { computeIngestUse, type RepoLiveness, type SupervisionPressure } from './use-model.js';

const REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;
const NOW = '2026-06-04T12:30:00.000Z';
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (h: number): string => new Date(Date.parse(NOW) - h * HOUR_MS).toISOString();

const NO_PRESSURE: SupervisionPressure = {
  restartCount: 0,
  restartBudget: 18,
  escalatedChildIds: [],
};

describe('computeIngestUse — Utilization', () => {
  it('counts fresh workers only; stale workers are NOT utilized', () => {
    const liveness: RepoLiveness[] = [
      { repo: 'iec', fresh: true },
      { repo: 'iel', fresh: true },
      { repo: 'iah', fresh: false, staleSince: hoursAgo(3) }, // stale ⇒ not utilized
      { repo: 'iaj', fresh: false },
      { repo: 'iar', fresh: false },
      { repo: 'ccp', fresh: false },
    ];
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(liveness, NO_PRESSURE, strip, NOW);
    expect(use.utilization.freshWorkers).toBe(2);
    expect(use.utilization.totalWorkers).toBe(6);
    expect(use.utilization.ratio).toBeCloseTo(2 / 6);
    expect(use.utilization.staleRepos).toEqual(['iah']);
  });

  it('all-silent current state ⇒ 0/6 utilization', () => {
    const liveness: RepoLiveness[] = REPOS.map((repo) => ({ repo, fresh: false }));
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(liveness, NO_PRESSURE, strip, NOW);
    expect(use.utilization.freshWorkers).toBe(0);
    expect(use.utilization.ratio).toBe(0);
  });

  it('no workers ⇒ ratio 0 (no divide-by-zero)', () => {
    const strip = buildFreshnessStrip([], [], NOW);
    const use = computeIngestUse([], NO_PRESSURE, strip, NOW);
    expect(use.utilization.ratio).toBe(0);
  });
});

describe('computeIngestUse — Saturation', () => {
  it('reports restart pressure as count + normalized ratio', () => {
    const liveness: RepoLiveness[] = REPOS.map((repo) => ({ repo, fresh: true }));
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const pressure: SupervisionPressure = {
      restartCount: 9,
      restartBudget: 18,
      escalatedChildIds: [],
    };
    const use = computeIngestUse(liveness, pressure, strip, NOW);
    expect(use.saturation.restartCount).toBe(9);
    expect(use.saturation.pressureRatio).toBeCloseTo(0.5);
    expect(use.saturation.escalated).toBe(false);
  });

  it('clamps pressure ratio at 1 when restarts exceed budget', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(
      [],
      { restartCount: 30, restartBudget: 18, escalatedChildIds: [] },
      strip,
      NOW,
    );
    expect(use.saturation.pressureRatio).toBe(1);
  });

  it('escalation flips saturation escalated=true', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(
      [],
      { restartCount: 3, restartBudget: 18, escalatedChildIds: ['ingest_worker:iaj'] },
      strip,
      NOW,
    );
    expect(use.saturation.escalated).toBe(true);
    expect(use.saturation.escalatedChildIds).toEqual(['ingest_worker:iaj']);
  });

  it('guards a zero/invalid budget (no divide-by-zero)', () => {
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(
      [],
      { restartCount: 2, restartBudget: 0, escalatedChildIds: [] },
      strip,
      NOW,
    );
    expect(Number.isFinite(use.saturation.pressureRatio)).toBe(true);
    expect(use.saturation.pressureRatio).toBe(1); // 2/1 clamped to 1
  });
});

describe('computeIngestUse — Errors', () => {
  it('counts crashes and preserves structured reasons', () => {
    const liveness: RepoLiveness[] = [
      { repo: 'iec', fresh: true },
      {
        repo: 'iaj',
        fresh: false,
        failure: { step: 'verify_rekor', reasonCode: 'no_inclusion_proof' },
      },
      {
        repo: 'ccp',
        fresh: false,
        failure: { step: 'schema_validate', reasonCode: 'kernel_reject' },
      },
    ];
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(liveness, NO_PRESSURE, strip, NOW);
    expect(use.errors.crashCount).toBe(2);
    expect(use.errors.crashes).toEqual([
      { repo: 'iaj', step: 'verify_rekor', reasonCode: 'no_inclusion_proof' },
      { repo: 'ccp', step: 'schema_validate', reasonCode: 'kernel_reject' },
    ]);
  });

  it('zero crashes when all workers healthy', () => {
    const liveness: RepoLiveness[] = REPOS.map((repo) => ({ repo, fresh: true }));
    const strip = buildFreshnessStrip(REPOS, [], NOW);
    const use = computeIngestUse(liveness, NO_PRESSURE, strip, NOW);
    expect(use.errors.crashCount).toBe(0);
    expect(use.errors.crashes).toEqual([]);
  });
});

describe('computeIngestUse — fully-silent repos (from the 24h strip)', () => {
  it('surfaces repos with zero verified rows across the whole window', () => {
    // iec fresh this hour; the rest silent for 24h.
    const rows: FreshnessRowInput[] = [
      { repo: 'iec', evaluatedAt: hoursAgo(0.1), decision: 'pass' },
    ];
    const liveness: RepoLiveness[] = REPOS.map((repo) => ({ repo, fresh: repo === 'iec' }));
    const strip = buildFreshnessStrip(REPOS, rows, NOW);
    const use = computeIngestUse(liveness, NO_PRESSURE, strip, NOW);
    expect(use.fullySilentRepos).toEqual(['iel', 'iah', 'iaj', 'iar', 'ccp']);
    expect(use.fullySilentRepos).not.toContain('iec');
  });
});
