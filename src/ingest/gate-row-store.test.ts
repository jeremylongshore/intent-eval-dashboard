/**
 * Gate-row store tests (Memory + Fs).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsGateRowStore, MemoryGateRowStore } from './gate-row-store.js';

const KEY = 'sha256:' + 'a'.repeat(64);
const ROWS = { repo: 'iec', bodies: [{ gate_name: 'coverage', gate_decision: 'pass' }] };

describe('MemoryGateRowStore', () => {
  it('round-trips a put/get', async () => {
    const s = new MemoryGateRowStore();
    expect(await s.get(KEY)).toBeNull();
    await s.put(KEY, ROWS);
    expect(await s.get(KEY)).toEqual(ROWS);
  });
});

describe('FsGateRowStore', () => {
  it('persists + reads back, returns null for an unknown key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iep-gaterows-'));
    try {
      const s = new FsGateRowStore(dir);
      expect(await s.get(KEY)).toBeNull();
      await s.put(KEY, ROWS);
      expect(await s.get(KEY)).toEqual(ROWS);
      // bare-hex key (no sha256: prefix) resolves to the same path
      expect(await s.get('a'.repeat(64))).toEqual(ROWS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('round-trips a verified Rekor anchor and drops a malformed one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iep-gaterows-rekor-'));
    try {
      const s = new FsGateRowStore(dir);
      const anchored = { ...ROWS, rekorLogIndices: [1689291334] };
      await s.put(KEY, anchored);
      expect(await s.get(KEY)).toEqual(anchored);
      // A non-integer / negative index is never coerced into an anchor.
      await writeFile(
        join(dir, 'gate-rows', 'a'.repeat(64) + '.json'),
        JSON.stringify({ ...ROWS, rekorLogIndices: [-1, 'x'] }),
      );
      expect(await s.get(KEY)).toEqual(ROWS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null for truncated JSON or a malformed stored shape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iep-gaterows-malformed-'));
    try {
      const s = new FsGateRowStore(dir);
      await s.put(KEY, ROWS);
      const path = join(dir, 'gate-rows', `${'a'.repeat(64)}.json`);

      await writeFile(path, '{"repo":"iec","bodies":[');
      expect(await s.get(KEY)).toBeNull();

      await writeFile(path, JSON.stringify({ repo: 'iec', bodies: 'not-an-array' }));
      expect(await s.get(KEY)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
