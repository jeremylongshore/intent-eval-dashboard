/**
 * In-memory content + snapshot stores.
 *
 * Used as the default for tests and for any environment that doesn't wire the
 * filesystem store. The content store is genuinely content-addressed (keyed by
 * sha256) and idempotent, so it exercises the same survival semantics the
 * production filesystem store does.
 */

import { sha256Key } from './content-address.js';
import { type ContentStore, type IngestSnapshot, type SnapshotStore } from './interfaces.js';

export class MemoryContentStore implements ContentStore {
  private readonly objects = new Map<string, Uint8Array>();

  put(bytes: Uint8Array): Promise<string> {
    const key = sha256Key(bytes);
    if (!this.objects.has(key)) {
      this.objects.set(key, Uint8Array.from(bytes));
    }
    return Promise.resolve(key);
  }

  get(key: string): Promise<Uint8Array | null> {
    const found = this.objects.get(key);
    return Promise.resolve(found === undefined ? null : Uint8Array.from(found));
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.objects.has(key));
  }

  /** Number of stored objects (test/observability convenience). */
  size(): number {
    return this.objects.size;
  }
}

export class MemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, IngestSnapshot>();

  put(snapshot: IngestSnapshot): Promise<void> {
    this.snapshots.set(snapshot.repo, snapshot);
    return Promise.resolve();
  }

  get(repo: string): Promise<IngestSnapshot | null> {
    return Promise.resolve(this.snapshots.get(repo) ?? null);
  }
}
