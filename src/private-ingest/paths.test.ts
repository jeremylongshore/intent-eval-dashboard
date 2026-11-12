import { afterEach, describe, expect, it } from 'vitest';
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertPrivateTree,
  FileCredentials,
  readPrivateFile,
  validatePrivatePaths,
  type PrivatePaths,
} from './paths.js';
import { configFixture } from './__fixtures__/config.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(): Promise<PrivatePaths> {
  const root = await mkdtemp(join(tmpdir(), 'private-ingest-test-'));
  roots.push(root);
  const paths = {
    privateRoot: root,
    config: join(root, 'config.json'),
    credentials: join(root, 'credentials'),
    state: join(root, 'state'),
    output: join(root, 'output'),
  };
  await writeFile(paths.config, JSON.stringify(configFixture()), { mode: 0o600 });
  await mkdir(paths.credentials, { mode: 0o700 });
  return paths;
}

describe('private filesystem authority', () => {
  it('admits isolated owner-only paths and reads bound credentials', async () => {
    const paths = await fixture();
    await validatePrivatePaths(paths, []);
    await writeFile(join(paths.credentials, 'fixture-token'), 'SYNTHETIC_SECRET\n', {
      mode: 0o600,
    });
    const provider = new FileCredentials(paths.credentials, configFixture());
    expect(await provider.token('fixture-token', 'fixture/private')).toBe('SYNTHETIC_SECRET');
    await expect(provider.token('fixture-token', 'wrong/repo')).rejects.toThrow(
      'credential_rejected',
    );
    await expect(provider.token('../config', 'fixture/private')).rejects.toThrow(
      'credential_rejected',
    );
  });
  it.each(['config', 'credentials', 'output'])(
    'rejects permissive %s before any collection',
    async (name) => {
      const paths = await fixture();
      await mkdir(paths.output, { mode: 0o700 });
      await chmod(paths[name as 'config' | 'credentials' | 'output'], 0o755);
      await expect(validatePrivatePaths(paths, [])).rejects.toThrow('path_rejected');
    },
  );
  it('rejects nested symlink into public output, leaving public canary intact', async () => {
    const paths = await fixture();
    const publicRoot = await mkdtemp(join(tmpdir(), 'public-canary-'));
    roots.push(publicRoot);
    await writeFile(join(publicRoot, 'index.html'), 'PUBLIC_CANARY');
    await mkdir(paths.output, { mode: 0o700 });
    await symlink(publicRoot, join(paths.output, 'internal'));
    await expect(validatePrivatePaths(paths, [publicRoot])).rejects.toThrow('path_rejected');
    expect(await readFile(join(publicRoot, 'index.html'), 'utf8')).toBe('PUBLIC_CANARY');
  });
  it('rejects hard-linked private output without overwriting the public alias', async () => {
    const paths = await fixture();
    await mkdir(paths.output, { mode: 0o700 });
    const target = join(paths.output, 'index.html');
    await writeFile(target, 'PUBLIC_CANARY', { mode: 0o600 });
    const external = await mkdtemp(join(tmpdir(), 'linked-public-'));
    roots.push(external);
    await link(target, join(external, 'index.html'));
    await expect(validatePrivatePaths(paths, [])).rejects.toThrow('path_rejected');
    expect(await readFile(target, 'utf8')).toBe('PUBLIC_CANARY');
  });
  it('rejects non-sticky writable ancestors and Git worktrees', async () => {
    const paths = await fixture();
    const nested = join(paths.privateRoot, 'nested');
    await mkdir(nested, { mode: 0o700 });
    const child = {
      privateRoot: nested,
      config: join(nested, 'config.json'),
      credentials: join(nested, 'credentials'),
      state: join(nested, 'state'),
      output: join(nested, 'output'),
    };
    await mkdir(child.credentials, { mode: 0o700 });
    await writeFile(child.config, '{}', { mode: 0o600 });
    await expect(validatePrivatePaths(child, [])).resolves.toEqual(child);
    await chmod(paths.privateRoot, 0o777);
    await expect(validatePrivatePaths(child, [])).rejects.toThrow('path_rejected');
    await chmod(paths.privateRoot, 0o700);
    await writeFile(join(paths.privateRoot, '.git'), 'gitdir: elsewhere', { mode: 0o600 });
    await expect(validatePrivatePaths(paths, [])).rejects.toThrow('path_rejected');
  });
  it('rejects overlapping state/credentials and public roots and escaping paths', async () => {
    const paths = await fixture();
    await expect(validatePrivatePaths({ ...paths, state: paths.credentials }, [])).rejects.toThrow(
      'path_rejected',
    );
    await expect(validatePrivatePaths(paths, [paths.output])).rejects.toThrow('path_rejected');
    await expect(
      validatePrivatePaths({ ...paths, output: '/tmp/private-escaped-output' }, []),
    ).rejects.toThrow('path_rejected');
    await expect(validatePrivatePaths({ ...paths, output: 'relative' }, [])).rejects.toThrow(
      'path_rejected',
    );
  });
  it('rejects a symlinked private root', async () => {
    const paths = await fixture();
    const aliasRoot = await mkdtemp(join(tmpdir(), 'private-alias-'));
    roots.push(aliasRoot);
    const alias = join(aliasRoot, 'alias');
    await symlink(paths.privateRoot, alias);
    await expect(validatePrivatePaths({ ...paths, privateRoot: alias }, [])).rejects.toThrow(
      'path_rejected',
    );
  });
  it('bounds no-follow file reads and rejects malformed UTF8', async () => {
    const paths = await fixture();
    await expect(readPrivateFile(paths.config, 1)).rejects.toThrow('path_rejected');
    await expect(readPrivateFile(paths.credentials, 20)).rejects.toThrow('path_rejected');
    const alias = join(paths.privateRoot, 'alias');
    await symlink(paths.config, alias);
    await expect(readPrivateFile(alias, 1000)).rejects.toThrow();
    await writeFile(paths.config, new Uint8Array([0xff]));
    await expect(readPrivateFile(paths.config, 100)).rejects.toThrow();
    await expect(assertPrivateTree(paths.privateRoot)).rejects.toThrow('path_rejected');
  });
  it.each(['', 'two words', 'secret\nsecond'])(
    'sanitizes invalid credential content',
    async (token) => {
      const paths = await fixture();
      await writeFile(join(paths.credentials, 'fixture-token'), token, { mode: 0o600 });
      await expect(
        new FileCredentials(paths.credentials, configFixture()).token(
          'fixture-token',
          'fixture/private',
        ),
      ).rejects.toThrow(/^credential_rejected$/u);
    },
  );
});
