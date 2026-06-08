/**
 * Gate-row store — persists the gate-result/v1 predicate BODIES alongside the
 * content-addressed EvidenceBundle.
 *
 * The 8-step ingest worker content-addresses the EvidenceBundle (the manifest /
 * receipt) and records its key in the snapshot. The bundle is strict and carries
 * NO predicate bodies — so the rows the dashboard renders (decision, gate_name,
 * gate_reasons, coverage …) live in the manifest row's `gateResults` field and
 * must be persisted separately, keyed by the SAME bundle content key, so the
 * render-time resolvers can pair each verified bundle with its rows.
 *
 * This store is written ONLY for rows the worker already verified (steps 3-6),
 * so a body can only be persisted after its enclosing bundle's signature +
 * Rekor inclusion + schema all passed. Verify-before-render is preserved: the
 * store never holds a body whose bundle was not verified.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The gate-result bodies for one verified bundle, plus the source repo. */
export interface StoredGateRows {
  /** Source repo key (one of the ingest repos) — drives render-time visibility. */
  readonly repo: string;
  /** The gate-result/v1 predicate bodies (snake_case, as emitted). */
  readonly bodies: readonly unknown[];
}

/** Persist + retrieve gate-result bodies by their bundle's content key. */
export interface GateRowStore {
  put(bundleKey: string, rows: StoredGateRows): Promise<void>;
  get(bundleKey: string): Promise<StoredGateRows | null>;
}

/** In-memory store (one-shot ingest runs + tests). */
export class MemoryGateRowStore implements GateRowStore {
  private readonly map = new Map<string, StoredGateRows>();
  put(bundleKey: string, rows: StoredGateRows): Promise<void> {
    this.map.set(bundleKey, rows);
    return Promise.resolve();
  }
  get(bundleKey: string): Promise<StoredGateRows | null> {
    return Promise.resolve(this.map.get(bundleKey) ?? null);
  }
}

/** Filesystem store — sibling of FsContentStore/FsSnapshotStore for the VPS. */
export class FsGateRowStore implements GateRowStore {
  constructor(private readonly root: string) {}

  private path(bundleKey: string): string {
    const hex = bundleKey.startsWith('sha256:') ? bundleKey.slice('sha256:'.length) : bundleKey;
    return join(this.root, 'gate-rows', `${hex}.json`);
  }

  async put(bundleKey: string, rows: StoredGateRows): Promise<void> {
    const path = this.path(bundleKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(rows), { mode: 0o600 });
  }

  async get(bundleKey: string): Promise<StoredGateRows | null> {
    const path = this.path(bundleKey);
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, 'utf8')) as StoredGateRows;
  }
}
