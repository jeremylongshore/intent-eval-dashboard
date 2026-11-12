import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsGateRowStore, type GateRowStore } from './gate-row-store.js';
import { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
import { runLivePass } from './live-pass.js';
import { OfflineRowVerifier } from './verifier-offline.js';
import {
  mintRow,
  signingClaimsFor,
  REPO_GITHUB,
  validEvidenceBundle,
  validGateResult,
} from './__fixtures__/bundle-fixtures.js';
import { ContentStoreBundleResolver } from '../results/bundle-resolver.js';
import { StoreGateRowSource } from '../results/store-gate-row-source.js';
import { StoreTestingResolver } from '../internal-testing/store-testing-resolver.js';
import { buildPublicResultsView } from '../results/generate.js';
import { buildTestingView } from '../internal-testing/testing-row.js';
import { canonicalJsonBytes } from './content-address.js';
import { renderInput, repoState } from '../results/__fixtures__/results-fixtures.js';

const NOW = '2026-06-08T00:00:00.000Z';
const BODY = validGateResult();
const BUNDLE = { ...validEvidenceBundle(BODY), rekor_log_indices: [] };

describe('repo provenance through real render pipelines', () => {
  it('keeps independently verified repos associated with their identical bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iep-provenance-ingest-'));
    try {
      const gateRowStore = new FsGateRowStore(root);
      const contentStore = new MemoryContentStore();
      const pinned = {
        issuer: 'https://token.actions.githubusercontent.com',
        repos: Object.fromEntries(
          ['iec', 'iel'].map((repo) => {
            const githubRepo = REPO_GITHUB[repo]!;
            return [
              repo,
              {
                githubRepo,
                subjects: [`repo:${githubRepo}:ref:refs/tags/*`],
                workflowRefs: [`${githubRepo}/.github/workflows/release.yml@refs/tags/*`],
                operatorConfirmed: true,
              },
            ];
          }),
        ),
      };
      const result = await runLivePass(
        {
          gateRowStore,
          contentStore,
          snapshotStore: new MemorySnapshotStore(),
          pinned,
          clock: { nowIso: () => NOW, nowMs: () => 0 },
          verifier: new OfflineRowVerifier(),
          fetcher: {
            fetch: async (repo) => ({
              repo,
              signing: signingClaimsFor(repo, REPO_GITHUB[repo]!),
              rows: [
                mintRow(repo, REPO_GITHUB[repo]!, { bundle: BUNDLE, gateResults: [BODY] }).row,
              ],
            }),
          },
        },
        ['iec', 'iel'],
      );
      expect(result.outcomes).toEqual([
        { repo: 'iec', fresh: true },
        { repo: 'iel', fresh: true },
      ]);
      const key = result.input.repos[0]!.snapshot!.bundleKeys[0]!;
      expect(result.input.repos[1]!.snapshot!.bundleKeys).toEqual([key]);
      for (const repo of ['iec', 'iel'])
        expect((await gateRowStore.get(key, repo))?.repo).toBe(repo);
      const publicView = await buildPublicResultsView(
        result.input,
        new ContentStoreBundleResolver(contentStore, new StoreGateRowSource(gateRowStore)),
        NOW,
      );
      const internalView = await buildTestingView(
        result.input,
        new StoreTestingResolver(contentStore, gateRowStore),
      );
      for (const view of [publicView, internalView]) {
        expect(view.repos.map((repo) => [repo.repo, repo.rows.length])).toEqual([
          ['iec', 1],
          ['iel', 1],
        ]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains per-repo fallback anchors and filters unknown repo visibility using caller context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iep-provenance-render-'));
    try {
      const store = new FsGateRowStore(root);
      const content = new MemoryContentStore();
      const key = await content.put(canonicalJsonBytes(BUNDLE));
      for (const [repo, index] of [
        ['iec', 11],
        ['iel', 22],
        ['external', 33],
      ] as const) {
        await store.put(key, { repo, bodies: [BODY], rekorLogIndices: [index] });
      }
      const input = renderInput(
        ['iec', 'iel', 'external'].map((repo) => repoState(repo, { bundleKeys: [key] })),
      );
      const publicView = await buildPublicResultsView(
        input,
        new ContentStoreBundleResolver(content, new StoreGateRowSource(store)),
        NOW,
      );
      const internalView = await buildTestingView(input, new StoreTestingResolver(content, store));
      expect(publicView.repos.map((r) => r.rows.map((row) => row.rekorLogIndices))).toEqual([
        [[11]],
        [[22]],
        [],
      ]);
      expect(publicView.repos[2]?.noData).toBe(true);
      expect(internalView.repos.map((r) => r.rows.map((row) => row.rekorLogIndices))).toEqual([
        [[11]],
        [[22]],
        [[33]],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a custom store returning another repo, despite a valid signed-body binding', async () => {
    const content = new MemoryContentStore();
    const key = await content.put(canonicalJsonBytes(BUNDLE));
    const wrongStore: GateRowStore = {
      put: async () => undefined,
      get: async () => ({ repo: 'iec', bodies: [BODY], rekorLogIndices: [11] }),
    };
    expect(await new StoreGateRowSource(wrongStore).rowsFor(key, BUNDLE, 'external')).toBeNull();
    expect(await new StoreTestingResolver(content, wrongStore).resolve(key, 'external')).toBeNull();
  });
});
