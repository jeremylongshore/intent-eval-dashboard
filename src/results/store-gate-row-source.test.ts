/**
 * StoreGateRowSource + visibility-policy tests.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validEvidenceBundle, validGateResult } from '../ingest/__fixtures__/bundle-fixtures.js';
import { FsGateRowStore, MemoryGateRowStore } from '../ingest/gate-row-store.js';
import { repoVisibility, StoreGateRowSource } from './store-gate-row-source.js';

const KEY = 'sha256:' + 'a'.repeat(64);
const BODY = { ...validGateResult(), gate_name: 'coverage' };
const BUNDLE = validEvidenceBundle(BODY);

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

describe('StoreGateRowSource', () => {
  it('projects a bound stored body into a gate-row projection with repo visibility', async () => {
    const store = new MemoryGateRowStore();
    await store.put(KEY, { repo: 'iec', bodies: [BODY] });
    const rows = await new StoreGateRowSource(store).rowsFor(KEY, BUNDLE);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({
      gateName: 'coverage',
      decision: 'pass',
      evaluatedAt: '2026-05-30T12:00:00.000Z',
      predicateUri: 'https://evals.intentsolutions.io/gate-result/v1',
      visibility: { tier: 'tier-1' },
    });
  });

  it('returns null for an absent bundle key', async () => {
    expect(await new StoreGateRowSource(new MemoryGateRowStore()).rowsFor(KEY, BUNDLE)).toBeNull();
  });

  it('returns null instead of coercing a malformed stored body', async () => {
    const store = new MemoryGateRowStore();
    await store.put(KEY, { repo: 'iec', bodies: [{ gate_decision: 'maybe' }] });
    expect(await new StoreGateRowSource(store).rowsFor(KEY, BUNDLE)).toBeNull();
  });

  it('returns null when a filesystem sidecar is changed after persistence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iep-gaterow-read-binding-'));
    try {
      const store = new FsGateRowStore(root);
      await store.put(KEY, { repo: 'iec', bodies: [BODY] });
      await writeFile(
        join(root, 'gate-rows', `${'a'.repeat(64)}.json`),
        JSON.stringify({
          repo: 'iec',
          bodies: [{ ...BODY, gate_decision: 'fail', gate_reasons: ['tampered'] }],
        }),
      );

      expect(await new StoreGateRowSource(store).rowsFor(KEY, BUNDLE)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
