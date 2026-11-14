/** Real worker/live-pass and filesystem persistence; offline signed fixture, no network. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIngestWorker } from './worker.js';
import { runLivePass, type LivePassDeps } from './live-pass.js';
import { FsContentStore, FsSnapshotStore } from './storage-fs.js';
import { FsGateRowStore } from './gate-row-store.js';
import { OfflineRowVerifier } from './verifier-offline.js';
import { mintManifest } from './__fixtures__/bundle-fixtures.js';
import { StoreTestingResolver } from '../internal-testing/store-testing-resolver.js';
import { buildTestingView } from '../internal-testing/testing-row.js';

const githubRepo = 'fixture/public';
const malformed = { step: 'fetch_manifest', reasonCode: 'manifest_malformed' };
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'empty-public-manifest-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
function fixture() {
  const manifest = mintManifest('iec', githubRepo);
  const deps: LivePassDeps = {
    fetcher: { fetch: () => Promise.resolve(manifest) },
    verifier: new OfflineRowVerifier(),
    contentStore: new FsContentStore(root),
    snapshotStore: new FsSnapshotStore(root),
    gateRowStore: new FsGateRowStore(root),
    clock: { nowIso: () => '2026-11-12T00:00:00.000Z', nowMs: () => 0 },
    pinned: {
      issuer: manifest.signing.issuer,
      repos: {
        iec: {
          githubRepo,
          operatorConfirmed: true,
          subjects: [`repo:${githubRepo}:ref:refs/tags/*`],
          workflowRefs: [`${githubRepo}/.github/workflows/release.yml@refs/tags/*`],
        },
      },
    },
  };
  return {
    deps,
    emptyDeps: { ...deps, fetcher: { fetch: () => Promise.resolve({ ...manifest, rows: [] }) } },
  };
}
describe('empty public manifests cannot become verified evidence', () => {
  it('rejects before crypto or any persistence, preserving the existing verified snapshot', async () => {
    const { deps, emptyDeps } = fixture();
    const prior = await runIngestWorker('iec', deps);
    expect(prior.bundleKeys).toHaveLength(1);
    const verify = vi.spyOn(deps.verifier, 'verifyRow');
    const content = vi.spyOn(deps.contentStore, 'put');
    const rows = vi.spyOn(deps.gateRowStore, 'put');
    const snapshots = vi.spyOn(deps.snapshotStore, 'put');
    await expect(runIngestWorker('iec', emptyDeps)).rejects.toMatchObject({ reason: malformed });
    expect(verify).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
    expect(rows).not.toHaveBeenCalled();
    expect(snapshots).not.toHaveBeenCalled();
    expect(await deps.snapshotStore.get('iec')).toEqual(prior);
  });
  it('reports first empty acquisition as failed/no-data, never fresh', async () => {
    const { emptyDeps } = fixture();
    const pass = await runLivePass(emptyDeps, ['iec']);
    expect(pass.outcomes).toEqual([{ repo: 'iec', fresh: false, failure: malformed }]);
    expect(pass.input.repos[0]?.snapshot).toBeNull();
    expect(await emptyDeps.snapshotStore.get('iec')).toBeNull();
    const view = await buildTestingView(
      pass.input,
      new StoreTestingResolver(emptyDeps.contentStore, emptyDeps.gateRowStore),
    );
    expect(view.repos[0]?.noData).toBe(true);
  });
  it('retains real prior rows with stale accounting after a later empty response', async () => {
    const { deps, emptyDeps } = fixture();
    const good = await runLivePass(deps, ['iec']);
    expect(good.outcomes).toEqual([{ repo: 'iec', fresh: true }]);
    const prior = good.input.repos[0]?.snapshot;
    expect(prior?.bundleKeys).toHaveLength(1);
    const failed = await runLivePass(emptyDeps, ['iec']);
    expect(failed.outcomes).toEqual([{ repo: 'iec', fresh: false, failure: malformed }]);
    expect(failed.input.repos[0]?.snapshot).toEqual(prior);
    expect(failed.input.repos[0]?.staleSince).toBe(prior?.lastKnownGoodIngestedAt);
    const view = await buildTestingView(
      failed.input,
      new StoreTestingResolver(deps.contentStore, deps.gateRowStore),
    );
    expect(view.repos[0]?.noData).toBe(false);
    expect(view.repos[0]?.rows).toHaveLength(1);
    expect(view.repos[0]?.staleSince).toBeDefined();
  });
});
