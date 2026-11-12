import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TrustedRoot } from '@sigstore/protobuf-specs';
import { loggedFixture } from '../ingest/__fixtures__/sigstore-fixtures.js';
import { mintManifest } from '../ingest/__fixtures__/bundle-fixtures.js';
import { canonicalJsonBytes } from '../ingest/content-address.js';
import { privateGeneration } from './generation.js';
import { configFixture } from './__fixtures__/config.js';
const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('built private CLI', () => {
  it('uses default production wiring with only fixture HTTP and TUF acquisition intercepted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'private-cli-'));
    roots.push(root);
    const privateRoot = join(root, 'private');
    await mkdir(privateRoot, { mode: 0o700 });
    const credentials = join(privateRoot, 'credentials');
    await mkdir(credentials, { mode: 0o700 });
    await writeFile(join(credentials, 'fixture-token'), 'SYNTHETIC_TOKEN_CANARY', { mode: 0o600 });
    const generation = privateGeneration(configFixture());
    const config = join(privateRoot, 'config.json');
    await writeFile(config, JSON.stringify(configFixture()), { mode: 0o600 });
    const manifest = mintManifest('private-canary', 'fixture/private');
    const row = manifest.rows[0]!;
    const signed = await loggedFixture({
      payload: Buffer.from(canonicalJsonBytes(row.bundle)),
      identity: `https://github.com/${manifest.signing.workflowRef}`,
      issuer: manifest.signing.issuer,
    });
    const actualManifest = { ...manifest, rows: [{ ...row, sigstoreBundle: signed.bundle }] };
    const data = join(root, 'fixture.json');
    await writeFile(
      data,
      JSON.stringify({
        manifest: actualManifest,
        trustedRoot: TrustedRoot.toJSON(signed.trustedRoot),
      }),
      { mode: 0o600 },
    );
    const preload = join(root, 'network-guard.cjs');
    // Test-only preload. Production CLI has no endpoint, verifier or trust override flag.
    await writeFile(
      preload,
      `
const { createRequire, syncBuiltinESMExports } = require('node:module');
const req = createRequire(process.cwd() + '/package.json');
const fixture = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(data)}, 'utf8'));
const tuf = createRequire(req.resolve('sigstore'))('@sigstore/tuf');
tuf.getTrustedRoot = async () => req('@sigstore/protobuf-specs').TrustedRoot.fromJSON(fixture.trustedRoot);
for (const protocol of ['node:http', 'node:https']) {
  const mod = require(protocol);
  mod.request = mod.get = () => { throw new Error('NETWORK_FORBIDDEN'); };
}
require('node:net').Socket.prototype.connect = () => { throw new Error('NETWORK_FORBIDDEN'); };
syncBuiltinESMExports();
let calls = 0;
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://api.github.com/repos/fixture/private/releases/') || options.headers.Authorization !== 'Bearer SYNTHETIC_TOKEN_CANARY') throw new Error('UNEXPECTED_REQUEST');
  calls++;
  if (url.endsWith('/tags/v1')) return new Response(JSON.stringify({id:7}));
  if (url.endsWith('/7/assets?per_page=100&page=1')) return new Response(JSON.stringify([{id:9,name:'report-manifest.json',state:'uploaded'}]));
  if (url.endsWith('/assets/9')) return new Response(JSON.stringify(fixture.manifest));
  throw new Error('UNEXPECTED_REQUEST');
};
process.on('exit', () => { if(calls !== 3) process.exitCode = 97; });
`,
      { mode: 0o600 },
    );
    const { stdout, stderr } = await execute(
      process.execPath,
      [
        '--require',
        preload,
        '--experimental-strip-types',
        'scripts/ingest-private.ts',
        '--private-root',
        privateRoot,
        '--config',
        config,
        '--credentials',
        credentials,
        '--state',
        join(privateRoot, 'state'),
        '--output',
        join(privateRoot, 'output'),
      ],
      {
        cwd: process.cwd(),
        env: { PATH: process.env['PATH'], NODE_NO_WARNINGS: '1' },
        timeout: 15_000,
      },
    );
    expect(JSON.parse(stdout)).toEqual({ generation, sources: 1, verified: 1, failed: 0 });
    expect(stdout + stderr).not.toContain('SYNTHETIC_TOKEN_CANARY');
    expect(stderr).toBe('');
    const snapshotPath = join(privateRoot, 'state', generation, 'snapshots/private-canary.json');
    const prior = await readFile(snapshotPath, 'utf8');
    const changed = {
      ...actualManifest,
      rows: [
        {
          ...actualManifest.rows[0]!,
          sourceSha: 'f'.repeat(40),
          bundle: { ...(row.bundle as Record<string, unknown>), row_count: 999 },
        },
      ],
    };
    await writeFile(
      data,
      JSON.stringify({ manifest: changed, trustedRoot: TrustedRoot.toJSON(signed.trustedRoot) }),
      { mode: 0o600 },
    );
    const failure = await execute(
      process.execPath,
      [
        '--require',
        preload,
        '--experimental-strip-types',
        'scripts/ingest-private.ts',
        '--private-root',
        privateRoot,
        '--config',
        config,
        '--credentials',
        credentials,
        '--state',
        join(privateRoot, 'state'),
        '--output',
        join(privateRoot, 'output'),
      ],
      {
        cwd: process.cwd(),
        env: { PATH: process.env['PATH'], NODE_NO_WARNINGS: '1' },
        timeout: 15_000,
      },
    ).then(
      () => {
        throw new Error('tampered CLI unexpectedly passed');
      },
      (error: unknown) => error as { code: number; stdout: string; stderr: string },
    );
    expect(failure.code).toBe(1);
    expect(JSON.parse(failure.stdout)).toEqual({ generation, sources: 1, verified: 0, failed: 1 });
    expect(failure.stdout + failure.stderr).not.toContain('SYNTHETIC_TOKEN_CANARY');
    expect(failure.stderr).toBe('');
    expect(await readFile(snapshotPath, 'utf8')).toBe(prior);
    expect(
      await readFile(
        join(privateRoot, 'output', generation, 'internal/testing/private-canary/index.html'),
        'utf8',
      ),
    ).toContain('gate-7-layer');
  });
});
