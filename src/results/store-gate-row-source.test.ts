/**
 * StoreGateRowSource + visibility-policy tests.
 */

import { describe, expect, it } from 'vitest';
import { MemoryGateRowStore } from '../ingest/gate-row-store.js';
import { coerceDecision, repoVisibility, StoreGateRowSource } from './store-gate-row-source.js';

const KEY = 'sha256:' + 'a'.repeat(64);

describe('repoVisibility', () => {
  it('maps the eight IS repos to Tier-1', () => {
    for (const r of ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp', 'jrig', 'qmd']) {
      expect(repoVisibility(r)).toEqual({ tier: 'tier-1' });
    }
  });
  it('fails closed to Tier-2 for an unknown repo', () => {
    expect(repoVisibility('rogue')).toEqual({ tier: 'tier-2' });
  });
});

describe('coerceDecision', () => {
  it('passes through the closed enum', () => {
    for (const d of ['pass', 'fail', 'advisory', 'error'] as const) {
      expect(coerceDecision(d)).toBe(d);
    }
  });
  it('fails closed to error for anything else', () => {
    expect(coerceDecision('maybe')).toBe('error');
    expect(coerceDecision(undefined)).toBe('error');
  });
});

describe('StoreGateRowSource', () => {
  it('projects stored bodies into gate-row projections with repo visibility', async () => {
    const store = new MemoryGateRowStore();
    await store.put(KEY, {
      repo: 'iec',
      bodies: [
        { gate_name: 'coverage', gate_decision: 'pass', evaluated_at: '2026-06-08T00:00:00.000Z' },
        {
          gate_name: 'architecture',
          gate_decision: 'fail',
          evaluated_at: '2026-06-08T00:01:00.000Z',
        },
      ],
    });
    const rows = await new StoreGateRowSource(store).rowsFor(KEY);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows?.[0]).toMatchObject({
      gateName: 'coverage',
      decision: 'pass',
      evaluatedAt: '2026-06-08T00:00:00.000Z',
      predicateUri: 'https://evals.intentsolutions.io/gate-result/v1',
      visibility: { tier: 'tier-1' },
    });
    expect(rows?.[1]?.decision).toBe('fail');
  });

  it('returns null for an absent bundle key', async () => {
    expect(await new StoreGateRowSource(new MemoryGateRowStore()).rowsFor(KEY)).toBeNull();
  });

  it('returns null when the stored entry has no bodies', async () => {
    const store = new MemoryGateRowStore();
    await store.put(KEY, { repo: 'iec', bodies: [] });
    expect(await new StoreGateRowSource(store).rowsFor(KEY)).toBeNull();
  });

  it('defaults missing gate_name / evaluated_at fields', async () => {
    const store = new MemoryGateRowStore();
    await store.put(KEY, { repo: 'iec', bodies: [{ gate_decision: 'pass' }] });
    const rows = await new StoreGateRowSource(store).rowsFor(KEY);
    expect(rows?.[0]).toMatchObject({ gateName: 'unknown', evaluatedAt: '' });
  });
});
