/**
 * Filesystem-backed content + snapshot stores (production default).
 *
 * Content objects are written under `<root>/objects/<hex>` keyed by sha256;
 * snapshots under `<root>/snapshots/<repo>.json`. The configurable `root`
 * defaults to `/var/lib/labs-dashboard/bundles/` per DR-035 B2 (CISO binding:
 * local Contabo disk, NOT GCP object storage). Tests pass a tmp dir — this code
 * NEVER creates the production path on import; the path is only touched when a
 * store instance actually writes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Key } from './content-address.js';
import { type ContentStore, type IngestSnapshot, type SnapshotStore } from './interfaces.js';

/** DR-035 B2 default storage root (local Contabo disk). */
export const DEFAULT_STORAGE_ROOT = '/var/lib/labs-dashboard/bundles/';

function keyToPath(root: string, key: string): string {
  // key is `sha256:<hex>` — store under objects/<hex> to keep filenames clean.
  const hex = key.startsWith('sha256:') ? key.slice('sha256:'.length) : key;
  return join(root, 'objects', hex);
}

export class FsContentStore implements ContentStore {
  constructor(private readonly root: string) {}

  async put(bytes: Uint8Array): Promise<string> {
    const key = sha256Key(bytes);
    const path = keyToPath(this.root, key);
    if (!existsSync(path)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { mode: 0o600 });
    }
    return key;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const path = keyToPath(this.root, key);
    if (!existsSync(path)) return null;
    const buf = await readFile(path);
    return new Uint8Array(buf);
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(existsSync(keyToPath(this.root, key)));
  }
}

export class FsSnapshotStore implements SnapshotStore {
  constructor(private readonly root: string) {}

  private path(repo: string): string {
    return join(this.root, 'snapshots', `${repo}.json`);
  }

  async put(snapshot: IngestSnapshot): Promise<void> {
    const path = this.path(snapshot.repo);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  }

  async get(repo: string): Promise<IngestSnapshot | null> {
    const path = this.path(repo);
    if (!existsSync(path)) return null;
    const text = await readFile(path, 'utf8');
    return JSON.parse(text) as IngestSnapshot;
  }
}

/** Default ISO + epoch clock. */
export const systemIngestClock = {
  nowIso: (): string => new Date().toISOString(),
  nowMs: (): number => Date.now(),
};
