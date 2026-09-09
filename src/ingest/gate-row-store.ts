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
 * The production writer stores rows only after verification. The store itself
 * is not a trust boundary: every production reader re-validates a stored body
 * against its signed bundle before rendering it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

/**
 * Filesystem store — sibling of FsContentStore/FsSnapshotStore for the VPS.
 *
 * Existing cached rows stay in the stable namespace across rollout. They are
 * safe to reuse only because both render paths now bind every body back to its
 * signed EvidenceBundle; a pre-fix row that was altered fails closed to no-data.
 */
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
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('repo' in parsed) ||
      typeof parsed.repo !== 'string' ||
      !('bodies' in parsed) ||
      !Array.isArray(parsed.bodies)
    ) {
      return null;
    }
    return { repo: parsed.repo, bodies: parsed.bodies };
  }
}
