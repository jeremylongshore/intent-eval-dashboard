/**
 * StoreTestingResolver tests — richer rows from content store + gate-row store.
 */

import { describe, expect, it } from 'vitest';
import { MemoryContentStore } from '../ingest/storage-memory.js';
import { canonicalJsonBytes } from '../ingest/content-address.js';
import { MemoryGateRowStore } from '../ingest/gate-row-store.js';
import { validEvidenceBundle, validGateResult } from '../ingest/__fixtures__/bundle-fixtures.js';
import { StoreTestingResolver } from './store-testing-resolver.js';

const BODY = {
  ...validGateResult(),
  gate_id: 'iec:ci:coverage',
  gate_name: 'coverage',
  gate_version: '1.0.0',
  gate_decision: 'fail',
  gate_reasons: ['branches 88% < floor 90%'],
  coverage: { dimensions_evaluated: ['lines', 'branches'], dimensions_skipped: ['mutation'] },
  evaluated_at: '2026-06-08T00:00:00.000Z',
  failure_mode: 'coverage-below-floor',
  advisory_severity: 'warn',
};

async function setup(bodies: unknown[] = [BODY]) {
  const content = new MemoryContentStore();
  const gateRows = new MemoryGateRowStore();
  const firstBody = bodies[0];
  const bundle =
    firstBody !== null && typeof firstBody === 'object' && !Array.isArray(firstBody)
      ? validEvidenceBundle(firstBody as Record<string, unknown>)
      : validEvidenceBundle();
  const key = await content.put(canonicalJsonBytes(bundle));
  await gateRows.put(key, { repo: 'iec', bodies });
  return { content, gateRows, key };
}

describe('StoreTestingResolver', () => {
  it('reconstructs a richer testing row from a verified bundle + stored bodies', async () => {
    const { content, gateRows, key } = await setup();
    const rows = await new StoreTestingResolver(content, gateRows).resolve(key);
    expect(rows).not.toBeNull();
    expect(rows?.[0]).toMatchObject({
      gateId: 'iec:ci:coverage',
      gateName: 'coverage',
      gateVersion: '1.0.0',
      decision: 'fail',
      gateReasons: ['branches 88% < floor 90%'],
      coverage: { dimensionsEvaluated: ['lines', 'branches'], dimensionsSkipped: ['mutation'] },
      failureMode: 'coverage-below-floor',
      advisorySeverity: 'warn',
      predicateUri: 'https://evals.intentsolutions.io/gate-result/v1',
    });
    // bundle meta is sourced from the verified EvidenceBundle
    expect(rows?.[0]?.bundleCreatedAt).toBe('2026-05-30T12:00:00.000Z');
    expect(rows?.[0]?.rekorLogIndices).toEqual([1689291334]);
  });

  it('omits optional failureMode/advisorySeverity when absent', async () => {
    const { content, gateRows, key } = await setup([{ ...validGateResult(), gate_name: 'arch' }]);
    const rows = await new StoreTestingResolver(content, gateRows).resolve(key);
    expect(rows?.[0]?.failureMode).toBeUndefined();
    expect(rows?.[0]?.advisorySeverity).toBeUndefined();
    expect(rows?.[0]?.decision).toBe('pass');
    expect(rows?.[0]?.coverage).toEqual({
      dimensionsEvaluated: ['seven-layer'],
      dimensionsSkipped: [],
    });
  });

  it('returns null when a persisted body is changed after verification', async () => {
    const { content, gateRows, key } = await setup();
    const stored = await gateRows.get(key);
    expect(stored).not.toBeNull();
    await gateRows.put(key, {
      repo: stored!.repo,
      bodies: [{ ...BODY, gate_decision: 'pass', gate_reasons: ['tampered'] }],
    });

    expect(await new StoreTestingResolver(content, gateRows).resolve(key)).toBeNull();
  });

  it('returns null rather than coercing a malformed persisted body', async () => {
    const { content, gateRows, key } = await setup();
    await gateRows.put(key, { repo: 'iec', bodies: [{ ...BODY, gate_decision: 'bogus' }] });

    expect(await new StoreTestingResolver(content, gateRows).resolve(key)).toBeNull();
  });

  it('returns null for an unknown content key', async () => {
    const { gateRows } = await setup();
    const r = new StoreTestingResolver(new MemoryContentStore(), gateRows);
    expect(await r.resolve('sha256:' + 'f'.repeat(64))).toBeNull();
  });

  it('returns null when the stored bytes are not JSON', async () => {
    const content = new MemoryContentStore();
    const key = await content.put(new TextEncoder().encode('not json'));
    const gateRows = new MemoryGateRowStore();
    await gateRows.put(key, { repo: 'iec', bodies: [BODY] });
    expect(await new StoreTestingResolver(content, gateRows).resolve(key)).toBeNull();
  });

  it('returns null when the bytes are valid JSON but not an EvidenceBundle', async () => {
    const content = new MemoryContentStore();
    const key = await content.put(canonicalJsonBytes({ not: 'a bundle' }));
    const gateRows = new MemoryGateRowStore();
    await gateRows.put(key, { repo: 'iec', bodies: [BODY] });
    expect(await new StoreTestingResolver(content, gateRows).resolve(key)).toBeNull();
  });

  it('returns null when there are no stored bodies for a verified bundle', async () => {
    const content = new MemoryContentStore();
    const key = await content.put(canonicalJsonBytes(validEvidenceBundle()));
    expect(
      await new StoreTestingResolver(content, new MemoryGateRowStore()).resolve(key),
    ).toBeNull();
  });
});
