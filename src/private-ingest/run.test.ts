import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintManifest } from '../ingest/__fixtures__/bundle-fixtures.js';
import { OfflineRowVerifier } from '../ingest/verifier-offline.js';
import { FsSnapshotStore } from '../ingest/storage-fs.js';
import { privateCli, runPrivateCollection } from './run.js';
import { privateGeneration } from './generation.js';
import { configFixture, jsonResponse, assetFixture } from './__fixtures__/config.js';
import type { PrivateHttp } from './github.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'private-run-'));
  roots.push(root);
  const paths = {
    privateRoot: root,
    config: join(root, 'enrollment.json'),
    credentials: join(root, 'credentials'),
    state: join(root, 'state'),
    output: join(root, 'output'),
  };
  await mkdir(paths.credentials, { mode: 0o700 });
  await writeFile(join(paths.credentials, 'fixture-token'), 'SYNTHETIC_TOKEN_CANARY', {
    mode: 0o600,
  });
  const config = configFixture();
  config.sources.push({
    ...config.sources[0]!,
    key: 'iec',
    githubRepo: 'fixture/second',
    credentialRef: 'second-token',
    subjects: ['repo:fixture/second:ref:refs/tags/*'],
    workflowRefs: ['fixture/second/.github/workflows/release.yml@refs/tags/*'],
  });
  config.credentials.push({ ref: 'second-token', repositories: ['fixture/second'] });
  await writeFile(join(paths.credentials, 'second-token'), 'SYNTHETIC_SECOND_TOKEN', {
    mode: 0o600,
  }); // Existing public alias stays private.
  await writeFile(paths.config, JSON.stringify(config), { mode: 0o600 });
  return { paths, config };
}
async function allFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await allFiles(path)));
    else result.push(path);
  }
  return result;
}
const argvFor = (paths: Awaited<ReturnType<typeof fixture>>['paths']) => [
  '--private-root',
  paths.privateRoot,
  '--config',
  paths.config,
  '--credentials',
  paths.credentials,
  '--state',
  paths.state,
  '--output',
  paths.output,
];

describe('isolated private command', () => {
  it('runs config-only sources through actual adapter, verification, private stores and render without touching public output', async () => {
    const { paths, config } = await fixture();
    const generation = privateGeneration(config);
    const pub = await mkdtemp(join(tmpdir(), 'public-run-canary-'));
    roots.push(pub);
    await writeFile(join(pub, 'status.html'), 'PUBLIC_STATUS_CANARY');
    const http = vi.fn<PrivateHttp>((url) => {
      if (url.includes('/tags/')) return Promise.resolve(jsonResponse({ id: 7 }));
      if (url.includes('?per_page=')) return Promise.resolve(jsonResponse([assetFixture()]));
      const second = url.includes('/fixture/second/');
      const manifest = mintManifest(
        second ? 'iec' : 'private-canary',
        second ? 'fixture/second' : 'fixture/private',
      );
      return Promise.resolve(jsonResponse(manifest));
    });
    const outcome = await privateCli(argvFor(paths), (options) =>
      runPrivateCollection({
        ...options,
        publicRoots: [pub],
        http,
        verifier: new OfflineRowVerifier(),
      }),
    );
    expect(outcome).toEqual({
      exitCode: 0,
      report: { generation, sources: 2, verified: 2, failed: 0 },
    });
    expect(http).toHaveBeenCalledTimes(6);
    expect(
      http.mock.calls
        .slice(0, 3)
        .every(([url]) => url.startsWith('https://api.github.com/repos/fixture/private/releases/')),
    ).toBe(true);
    expect(
      http.mock.calls
        .slice(3)
        .every(([url]) => url.startsWith('https://api.github.com/repos/fixture/second/releases/')),
    ).toBe(true);
    expect(new Headers(http.mock.calls[0]![1].headers).get('Authorization')).toBe(
      'Bearer SYNTHETIC_TOKEN_CANARY',
    );
    expect(new Headers(http.mock.calls[3]![1].headers).get('Authorization')).toBe(
      'Bearer SYNTHETIC_SECOND_TOKEN',
    );
    const snapshots = new FsSnapshotStore(join(paths.state, generation));
    const firstSnapshot = await snapshots.get('private-canary');
    const secondSnapshot = await snapshots.get('iec');
    expect(firstSnapshot?.bundleKeys).toEqual(secondSnapshot?.bundleKeys);
    expect(firstSnapshot?.bundleKeys).toHaveLength(1);
    const output = await allFiles(paths.output);
    expect(output).toHaveLength(4);
    expect(await readFile(join(paths.output, generation, 'style.css'))).toEqual(
      await readFile('site/style.css'),
    );
    expect(
      await readFile(
        join(paths.output, generation, 'internal/testing/private-canary/index.html'),
        'utf8',
      ),
    ).toContain('gate-7-layer');
    expect(
      await readFile(join(paths.output, generation, 'internal/testing/iec/index.html'), 'utf8'),
    ).toContain('gate-7-layer');
    expect(await readFile(join(pub, 'status.html'), 'utf8')).toBe('PUBLIC_STATUS_CANARY');
    expect(await readdir(pub)).toEqual(['status.html']);
    for (const file of [...(await allFiles(paths.state)), ...output]) {
      const handle = await open(file, 'r');
      try {
        expect((await handle.stat()).mode & 0o077).toBe(0);
        expect(await handle.readFile('utf8')).not.toContain('SYNTHETIC_TOKEN_CANARY');
      } finally {
        await handle.close();
      }
    }
  });
  it('preserves prior verified snapshots and never emits raw verifier errors', async () => {
    const { paths, config } = await fixture();
    config.sources.pop();
    await writeFile(paths.config, JSON.stringify(config));
    const manifest = mintManifest('private-canary', 'fixture/private');
    const http: PrivateHttp = (url) =>
      Promise.resolve(
        jsonResponse(
          url.includes('/tags/')
            ? { id: 7 }
            : url.includes('?per_page=')
              ? [assetFixture()]
              : manifest,
        ),
      );
    await runPrivateCollection({ paths, http, verifier: new OfflineRowVerifier() });
    const generation = privateGeneration(config);
    const before = await new FsSnapshotStore(join(paths.state, generation)).get('private-canary');
    const report = await runPrivateCollection({
      paths,
      http,
      verifier: { verifyRow: () => Promise.reject(new Error('RAW_SECRET_CANARY signed-query')) },
    });
    expect(report).toEqual({ generation, sources: 1, verified: 0, failed: 1 });
    expect(await new FsSnapshotStore(join(paths.state, generation)).get('private-canary')).toEqual(
      before,
    );
    const html = await readFile(
      join(paths.output, generation, 'internal/testing/private-canary/index.html'),
      'utf8',
    );
    expect(html).not.toContain('RAW_SECRET_CANARY');
    expect(html).not.toContain('signed-query');
  });
  it('actual CLI parser rejects forbidden paths before HTTP and keeps output sanitized', async () => {
    const { paths } = await fixture();
    const http = vi.fn<PrivateHttp>();
    const outcome = await privateCli(argvFor({ ...paths, output: process.cwd() }), (options) =>
      runPrivateCollection({ ...options, http }),
    );
    expect(outcome).toEqual({ exitCode: 1, report: { error: 'path_rejected' } });
    expect(http).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      ['--unknown', 'SECRET'],
      ['--private-root'],
      ['--private-root', '/tmp', '--private-root', '/tmp'],
    ].map((args) => ({ args })),
  )('rejects invalid command arguments without exposing values', async ({ args }) => {
    expect(await privateCli(args)).toEqual({
      exitCode: 1,
      report: { error: 'configuration_invalid' },
    });
  });
  it('sanitizes unexpected command failure', async () => {
    const { paths } = await fixture();
    expect(await privateCli(argvFor(paths), () => Promise.reject(new Error('SECRET')))).toEqual({
      exitCode: 1,
      report: { error: 'collection_failed' },
    });
  });
  it('public workflow and entrypoint stay outside the private lane', async () => {
    const workflow = await readFile('.github/workflows/regenerate.yml', 'utf8');
    const publicCommand = await readFile('scripts/ingest-render.ts', 'utf8');
    expect(workflow).not.toMatch(/ingest-private|private-ingest|--credentials|--private-root/u);
    expect(publicCommand).not.toMatch(/private-ingest|ingest-private/u);
  });
});
