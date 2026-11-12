import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { CredentialProvider } from './github.js';
import type { PrivateConfig } from './config.js';
import { PrivateIngestError } from './reason.js';

export function inside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Resolve existing ancestors even for a not-yet-created leaf. */
export async function canonicalPath(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new PrivateIngestError('path_rejected');
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new PrivateIngestError('path_rejected');
    const parent = dirname(path);
    if (parent === path) throw new PrivateIngestError('path_rejected');
    return join(await canonicalPath(parent), relative(parent, path));
  }
}

async function noGitAncestor(path: string): Promise<void> {
  for (let cursor = path; ; cursor = dirname(cursor)) {
    try {
      await lstat(join(cursor, '.git'));
      throw new PrivateIngestError('path_rejected');
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw new PrivateIngestError('path_rejected');
    }
    if (dirname(cursor) === cursor) return;
  }
}

/** Existing descendants must not bypass umask via symlinks or permissive files. */
export async function assertPrivateTree(root: string): Promise<void> {
  const stat = await lstat(root);
  if (
    stat.isSymbolicLink() ||
    (!stat.isDirectory() && !stat.isFile()) ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 ||
    (stat.isFile() && stat.nlink !== 1)
  ) {
    throw new PrivateIngestError('path_rejected');
  }
  if (stat.isDirectory()) {
    for (const name of await readdir(root)) await assertPrivateTree(join(root, name));
  }
}

export interface PrivatePaths {
  readonly privateRoot: string;
  readonly config: string;
  readonly credentials: string;
  readonly state: string;
  readonly output: string;
}

export async function validatePrivatePaths(
  paths: PrivatePaths,
  publicRoots: readonly string[],
): Promise<PrivatePaths> {
  const root = await canonicalPath(paths.privateRoot);
  if (root !== resolve(paths.privateRoot)) throw new PrivateIngestError('path_rejected');
  await trustedAncestors(root);
  await noGitAncestor(root);
  await assertPrivateTree(root);
  const canonical = {
    privateRoot: root,
    config: await canonicalPath(paths.config),
    credentials: await canonicalPath(paths.credentials),
    state: await canonicalPath(paths.state),
    output: await canonicalPath(paths.output),
  };
  const children = [canonical.config, canonical.credentials, canonical.state, canonical.output];
  for (const child of children) {
    if (child === root || !inside(root, child)) throw new PrivateIngestError('path_rejected');
    await noGitAncestor(child);
    for (const publicRoot of publicRoots) {
      const forbidden = await canonicalPath(publicRoot);
      if (inside(forbidden, child) || inside(child, forbidden))
        throw new PrivateIngestError('path_rejected');
    }
  }
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      if (inside(children[i]!, children[j]!) || inside(children[j]!, children[i]!))
        throw new PrivateIngestError('path_rejected');
    }
  }
  // Private root is owner-only. All existing descendants were checked above;
  // same-UID hostile mutations are outside this process's isolation boundary.
  await mkdir(canonical.state, { recursive: true, mode: 0o700 });
  await mkdir(canonical.output, { recursive: true, mode: 0o700 });
  return canonical;
}

export async function readPrivateFile(path: string, limit: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0 ||
      stat.nlink !== 1 ||
      stat.size > limit
    ) {
      throw new PrivateIngestError('path_rejected');
    }
    const bytes = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, null);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    if (count > limit) throw new PrivateIngestError('path_rejected');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
  } finally {
    await handle.close();
  }
}

export class FileCredentials implements CredentialProvider {
  constructor(
    private readonly root: string,
    private readonly config: PrivateConfig,
  ) {}
  async token(reference: string, githubRepo: string): Promise<string> {
    try {
      const binding = this.config.credentials.find((c) => c.ref === reference);
      if (
        !binding?.repositories.includes(githubRepo) ||
        !/^[a-z][a-z0-9-]{0,63}(?![\s\S])/u.test(reference)
      ) {
        throw new PrivateIngestError('credential_rejected');
      }
      await assertPrivateTree(this.root);
      const token = (await readPrivateFile(join(this.root, reference), 8192)).trim();
      if (!token || /\s/u.test(token)) throw new PrivateIngestError('credential_rejected');
      return token;
    } catch {
      throw new PrivateIngestError('credential_rejected');
    }
  }
}

/** Root-owned or current-UID ancestors; writable shared parents require sticky semantics. */
async function trustedAncestors(path: string): Promise<void> {
  for (let cursor = dirname(path); ; cursor = dirname(cursor)) {
    const stat = await lstat(cursor);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.uid !== 0 && stat.uid !== process.getuid?.()) ||
      ((stat.mode & 0o022) !== 0 && (stat.mode & 0o1000) === 0)
    ) {
      throw new PrivateIngestError('path_rejected');
    }
    if (dirname(cursor) === cursor) return;
  }
}
