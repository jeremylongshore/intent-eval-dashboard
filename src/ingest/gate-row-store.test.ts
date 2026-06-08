/**
 * Gate-row store tests (Memory + Fs).
 */

import { mkdtemp, rm } from 'node:fs/promises';
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
});
