import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FsSnapshotStore } from './storage-fs.js';
import { buildRenderInput } from './renderer.js';
import { describe, expect, it } from 'vitest';
import {
  publicVerificationGeneration,
  generationStoreRoot,
  generationSelector,
  newlyVerifiedRepoCount,
} from './verification-generation.js';
import type { RenderInput } from './renderer.js';

describe('public verification generation', () => {
  it('isolates policy/config while canonical key ordering is stable', () => {
    const first = publicVerificationGeneration({ issuer: 'issuer', repos: {} });
    expect(first).toEqual(publicVerificationGeneration({ repos: {}, issuer: 'issuer' }));
    expect(first).not.toEqual(publicVerificationGeneration({ issuer: 'other', repos: {} }));
    expect(generationStoreRoot('/store', first)).toBe(`/store/${generationSelector(first)}`);
    expect(() =>
      generationSelector({ ...first, configurationDigest: first.configurationDigest + '\n' }),
    ).toThrow();
  });
  it('does not equate unsigned empty manifests or old LKG with newly verified rows', () => {
    const input: RenderInput = {
      asOf: '2026-11-12T00:00:00Z',
      repos: [
        {
          repo: 'iec',
          snapshot: {
            repo: 'iec',
            lastKnownGoodIngestedAt: 'now',
            sourceSha: 'sha',
            bundleKeys: [],
          },
        },
        {
          repo: 'iel',
          snapshot: {
            repo: 'iel',
            lastKnownGoodIngestedAt: 'old',
            sourceSha: 'sha',
            bundleKeys: ['sha256:old'],
          },
        },
        { repo: 'iah', snapshot: null },
      ],
    };
    expect(
      newlyVerifiedRepoCount(input, [
        { repo: 'iec', fresh: true },
        { repo: 'iel', fresh: false },
        { repo: 'iah', fresh: true },
      ]),
    ).toBe(0);
    expect(newlyVerifiedRepoCount(input, [{ repo: 'iel', fresh: true }])).toBe(1);
  });
  it('never reads legacy snapshots while current-generation LKG survives a failed pass', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generation-stores-'));
    try {
      const legacy = new FsSnapshotStore(root);
      const snapshot = {
        repo: 'iec',
        lastKnownGoodIngestedAt: '2026-11-12T00:00:00Z',
        sourceSha: 'old',
        bundleKeys: ['sha256:old'],
      };
      await legacy.put(snapshot);
      const current = new FsSnapshotStore(
        generationStoreRoot(root, publicVerificationGeneration({ issuer: 'issuer', repos: {} })),
      );
      const failed = [{ repo: 'iec', fresh: false }];
      const empty = await buildRenderInput(current, failed, '2026-11-12T01:00:00Z');
      expect(empty.repos[0]?.snapshot).toBeNull();
      const verified = { ...snapshot, sourceSha: 'new', bundleKeys: ['sha256:new'] };
      await current.put(verified);
      const retained = await buildRenderInput(current, failed, '2026-11-12T02:00:00Z');
      expect(retained.repos[0]?.snapshot).toEqual(verified);
      expect(retained.repos[0]?.staleSince).toBe(verified.lastKnownGoodIngestedAt);
      expect(await legacy.get('iec')).toEqual(snapshot);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
