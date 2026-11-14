import type * as FsPromises from 'node:fs/promises';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FsGateRowStore, MemoryGateRowStore } from './gate-row-store.js';

const faults = vi.hoisted(() => ({ write: false, rename: false }));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof FsPromises>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      await actual.writeFile(...args);
      if (faults.write && typeof args[0] === 'string' && args[0].endsWith('.tmp'))
        throw new Error('write interrupted');
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (faults.rename) throw new Error('rename interrupted');
      await actual.rename(...args);
    },
  };
});

const KEY = `sha256:${'a'.repeat(64)}`;
const ROWS = { repo: 'iec', bodies: [], rekorLogIndices: [11] };
const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'iep-provenance-'));
  roots.push(root);
  const legacy = join(root, 'gate-rows', `${'a'.repeat(64)}.json`);
  const current = join(root, 'gate-rows', 'v2', 'iec', `${'a'.repeat(64)}.json`);
  await mkdir(join(root, 'gate-rows'), { recursive: true });
  return { root, legacy, current, store: new FsGateRowStore(root) };
}
afterEach(async () => {
  faults.write = false;
  faults.rename = false;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('repository-scoped sidecars', () => {
  it('keeps identical bundle keys distinct in memory and on disk', async () => {
    const { store } = await setup();
    for (const candidate of [store, new MemoryGateRowStore()]) {
      await Promise.all([
        candidate.put(KEY, ROWS),
        candidate.put(KEY, { ...ROWS, repo: 'iel', rekorLogIndices: [22] }),
      ]);
      expect(await candidate.get(KEY, 'iec')).toEqual(ROWS);
      expect(await candidate.get(KEY, 'iel')).toEqual({
        ...ROWS,
        repo: 'iel',
        rekorLogIndices: [22],
      });
      expect(await candidate.get(KEY, 'unknown')).toBeNull();
    }
  });

  it('reads only matching legacy provenance and never overwrites the old namespace', async () => {
    const { store, legacy } = await setup();
    const original = JSON.stringify(ROWS);
    await writeFile(legacy, original);
    expect(await store.get(KEY, 'iec')).toEqual(ROWS);
    expect(await store.get(KEY, 'iel')).toBeNull();
    await store.put(KEY, { ...ROWS, repo: 'iel', rekorLogIndices: [22] });
    expect(await store.get(KEY, 'iec')).toEqual(ROWS);
    expect((await store.get(KEY, 'iel'))?.rekorLogIndices).toEqual([22]);
    expect(await readFile(legacy, 'utf8')).toBe(original);
  });

  it.each(['{', JSON.stringify({ ...ROWS, repo: 'iel' }), JSON.stringify({ repo: 'iec' })])(
    'does not fall back from present invalid v2 data: %s',
    async (bad) => {
      const { store, legacy, current } = await setup();
      await writeFile(legacy, JSON.stringify(ROWS));
      await store.put(KEY, ROWS);
      await writeFile(current, bad);
      expect(await store.get(KEY, 'iec')).toBeNull();
    },
  );

  it('does not fall back on v2 filesystem errors', async () => {
    const { store, legacy, current } = await setup();
    await writeFile(legacy, JSON.stringify(ROWS));
    await mkdir(current, { recursive: true });
    await expect(store.get(KEY, 'iec')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it.each(['../escape', '.', 'a/b', 'a\\b', '', 'iec\n', 'iec\r\n'])(
    'rejects unsafe repo %j',
    async (repo) => {
      const { store } = await setup();
      await expect(store.put(KEY, { ...ROWS, repo })).rejects.toThrow('Invalid gate-row');
      await expect(store.get(KEY, repo)).rejects.toThrow('Invalid gate-row');
    },
  );

  it('rejects unsafe bundle keys', async () => {
    const { store } = await setup();
    await expect(store.get('../escape', 'iec')).rejects.toThrow('Invalid gate-row');
    await expect(store.put('sha256:bad', ROWS)).rejects.toThrow('Invalid gate-row');
    await expect(store.get(KEY + '\n', 'iec')).rejects.toThrow('Invalid gate-row');
  });
});

describe('atomic replacement', () => {
  it.each(['write', 'rename'] as const)(
    'preserves old complete rows and cleans up after %s failure',
    async (fault) => {
      const { store, root } = await setup();
      await store.put(KEY, ROWS);
      faults[fault] = true;
      await expect(store.put(KEY, { ...ROWS, rekorLogIndices: [22] })).rejects.toThrow(
        'interrupted',
      );
      expect(await store.get(KEY, 'iec')).toEqual(ROWS);
      expect(await readdir(join(root, 'gate-rows', 'v2', 'iec'))).toEqual([
        `${'a'.repeat(64)}.json`,
      ]);
    },
  );

  it('exposes only complete old or new values during overlapping replacements', async () => {
    const { store, root } = await setup();
    await store.put(KEY, ROWS);
    const variants = Array.from({ length: 12 }, (_, i) => ({ ...ROWS, rekorLogIndices: [i] }));
    await Promise.all([
      ...variants.map((rows) => store.put(KEY, rows)),
      (async () => {
        for (let i = 0; i < 40; i++) {
          const value = await store.get(KEY, 'iec');
          expect([ROWS, ...variants]).toContainEqual(value);
        }
      })(),
    ]);
    expect(variants).toContainEqual(await store.get(KEY, 'iec'));
    expect(await readdir(join(root, 'gate-rows', 'v2', 'iec'))).toEqual([`${'a'.repeat(64)}.json`]);
  });
});
