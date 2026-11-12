import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJsonBytes } from '../ingest/content-address.js';
import { mintManifest, mintRow, validGateResult } from '../ingest/__fixtures__/bundle-fixtures.js';
import { FsContentStore, FsSnapshotStore, systemIngestClock } from '../ingest/storage-fs.js';
import { FsGateRowStore } from '../ingest/gate-row-store.js';
import { runIngestWorker } from '../ingest/worker.js';
import { OfflineRowVerifier } from '../ingest/verifier-offline.js';
import { buildTestingView } from '../internal-testing/testing-row.js';
import { StoreTestingResolver } from '../internal-testing/store-testing-resolver.js';
import { generateTestingFiles, writeTestingSite } from '../internal-testing/generate-testing.js';
import { configFixture, assetFixture, jsonResponse } from './__fixtures__/config.js';
import { privatePins, type PrivateConfig } from './config.js';
import {
  PRIVATE_POLICY_GENERATION,
  privateConfigFingerprint,
  privateGeneration,
} from './generation.js';
import { runPrivateCollection } from './run.js';
import type { PrivateHttp } from './github.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'private-generation-'));
  roots.push(root);
  const paths = {
    privateRoot: root,
    config: join(root, 'config.json'),
    credentials: join(root, 'credentials'),
    state: join(root, 'state'),
    output: join(root, 'output'),
  };
  await mkdir(paths.credentials, { mode: 0o700 });
  await writeFile(join(paths.credentials, 'fixture-token'), 'SYNTHETIC_TOKEN', { mode: 0o600 });
  const config = configFixture();
  await writeFile(paths.config, JSON.stringify(config), { mode: 0o600 });
  return { paths, config };
}
async function fileBytes(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) Object.assign(files, await fileBytes(path));
    else files[path] = (await readFile(path)).toString('base64');
  }
  return files;
}
function manifestWithCanary() {
  const manifest = mintManifest('private-canary', 'fixture/private');
  const gate = { ...validGateResult(), gate_name: 'old-private-canary' };
  return {
    ...manifest,
    rows: [mintRow('private-canary', 'fixture/private', { gateResults: [gate] }).row],
  };
}
const offline = new OfflineRowVerifier();
const failingHttp: PrivateHttp = () => Promise.reject(new Error('synthetic unavailable'));
function successfulHttp(): PrivateHttp {
  const manifest = manifestWithCanary();
  return (url) =>
    Promise.resolve(
      jsonResponse(
        url.includes('/tags/')
          ? { id: 7 }
          : url.includes('?per_page=')
            ? [assetFixture()]
            : manifest,
      ),
    );
}
async function legacySeed(
  paths: Awaited<ReturnType<typeof setup>>['paths'],
  config: PrivateConfig,
) {
  const mask = process.umask(0o077);
  try {
    const contentStore = new FsContentStore(paths.state);
    const snapshotStore = new FsSnapshotStore(paths.state);
    const gateRowStore = new FsGateRowStore(paths.state);
    const snapshot = await runIngestWorker('private-canary', {
      contentStore,
      snapshotStore,
      gateRowStore,
      clock: systemIngestClock,
      pinned: privatePins(config),
      verifier: offline,
      fetcher: { fetch: () => Promise.resolve(manifestWithCanary()) },
    });
    const view = await buildTestingView(
      { asOf: systemIngestClock.nowIso(), repos: [{ repo: 'private-canary', snapshot }] },
      new StoreTestingResolver(contentStore, gateRowStore),
    );
    await writeTestingSite(generateTestingFiles(view, new Map()), paths.output);
  } finally {
    process.umask(mask);
  }
}

describe('private authenticated state generations', () => {
  it('normalizes key order while binding compiled policy and complete enrollment', () => {
    const config = configFixture();
    const reordered = Object.fromEntries(Object.entries(config).reverse()) as PrivateConfig;
    expect(canonicalJsonBytes(config)).toEqual(canonicalJsonBytes(reordered));
    expect(privateGeneration(config)).toBe(privateGeneration(reordered));
    expect(privateConfigFingerprint(config, 'next-auth-policy')).not.toBe(
      privateConfigFingerprint(config, PRIVATE_POLICY_GENERATION),
    );
    const changed = structuredClone(config);
    changed.sources[0]!.subjects = ['repo:fixture/private:ref:refs/heads/main'];
    expect(privateGeneration(changed)).not.toBe(privateGeneration(config));
  });
  it('never promotes an unversioned cache when fresh acquisition fails, leaving old bytes intact', async () => {
    const { paths, config } = await setup();
    await legacySeed(paths, config);
    const legacyHtml = await readFile(
      join(paths.output, 'internal/testing/private-canary/index.html'),
      'utf8',
    );
    expect(legacyHtml).toContain('old-private-canary');
    const before = { ...(await fileBytes(paths.state)), ...(await fileBytes(paths.output)) };
    const report = await runPrivateCollection({ paths, http: failingHttp, verifier: offline });
    expect(report).toEqual({
      generation: privateGeneration(config),
      sources: 1,
      verified: 0,
      failed: 1,
    });
    const html = await readFile(
      join(paths.output, report.generation, 'internal/testing/private-canary/index.html'),
      'utf8',
    );
    expect(html).not.toContain('old-private-canary');
    expect(
      await new FsSnapshotStore(join(paths.state, report.generation)).get('private-canary'),
    ).toBeNull();
    for (const [path, bytes] of Object.entries(before))
      expect((await readFile(path)).toString('base64')).toBe(bytes);
  });
  it('retains same-policy last verified state and ignores token-byte rotation in identity', async () => {
    const { paths } = await setup();
    const first = await runPrivateCollection({ paths, http: successfulHttp(), verifier: offline });
    expect(first.verified).toBe(1);
    const store = new FsSnapshotStore(join(paths.state, first.generation));
    const snapshot = await store.get('private-canary');
    expect(snapshot).not.toBeNull();
    await writeFile(join(paths.credentials, 'fixture-token'), 'ROTATED_SYNTHETIC_TOKEN');
    const next = await runPrivateCollection({ paths, http: failingHttp, verifier: offline });
    expect(next.generation).toBe(first.generation);
    expect(next.failed).toBe(1);
    expect(await store.get('private-canary')).toEqual(snapshot);
    const html = await readFile(
      join(paths.output, next.generation, 'internal/testing/private-canary/index.html'),
      'utf8',
    );
    expect(html).toContain('old-private-canary');
    expect(html).toContain(
      `<span class="badge badge--stale">stale since ${snapshot!.lastKnownGoodIngestedAt}</span>`,
    );
  });
  it.each(['pins', 'alias', 'repository'])(
    'starts empty state/output after changing %s',
    async (change) => {
      const { paths, config } = await setup();
      const first = await runPrivateCollection({
        paths,
        http: successfulHttp(),
        verifier: offline,
      });
      expect(first.verified).toBe(1);
      const oldFiles = {
        ...(await fileBytes(join(paths.state, first.generation))),
        ...(await fileBytes(join(paths.output, first.generation))),
      };
      const source = config.sources[0]!;
      if (change === 'pins') source.subjects = ['repo:fixture/private:ref:refs/heads/main'];
      if (change === 'alias') source.key = 'new-alias';
      if (change === 'repository') {
        source.githubRepo = 'fixture/another';
        source.subjects = ['repo:fixture/another:ref:refs/tags/*'];
        source.workflowRefs = ['fixture/another/.github/workflows/release.yml@refs/tags/*'];
        config.credentials[0]!.repositories = ['fixture/another'];
      }
      await writeFile(paths.config, JSON.stringify(config));
      const next = await runPrivateCollection({ paths, http: failingHttp, verifier: offline });
      expect(next.generation).not.toBe(first.generation);
      expect(
        await new FsSnapshotStore(join(paths.state, next.generation)).get(source.key),
      ).toBeNull();
      const html = await readFile(
        join(paths.output, next.generation, `internal/testing/${source.key}/index.html`),
        'utf8',
      );
      expect(html).not.toContain('old-private-canary');
      for (const [path, bytes] of Object.entries(oldFiles))
        expect((await readFile(path)).toString('base64')).toBe(bytes);
      expect(await readdir(paths.output)).toEqual([PRIVATE_POLICY_GENERATION]);
    },
  );
  it('rejects unsigned empty-row manifests without replacing verified state', async () => {
    const { paths } = await setup();
    const first = await runPrivateCollection({ paths, http: successfulHttp(), verifier: offline });
    expect(first.verified).toBe(1);
    const store = new FsSnapshotStore(join(paths.state, first.generation));
    const before = await store.get('private-canary');
    const empty = { ...manifestWithCanary(), rows: [] };
    const http: PrivateHttp = (url) =>
      Promise.resolve(
        jsonResponse(
          url.includes('/tags/')
            ? { id: 7 }
            : url.includes('?per_page=')
              ? [assetFixture()]
              : empty,
        ),
      );
    const report = await runPrivateCollection({ paths, http, verifier: offline });
    expect(report).toEqual({ generation: first.generation, sources: 1, verified: 0, failed: 1 });
    expect(await store.get('private-canary')).toEqual(before);
  });
});
