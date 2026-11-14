/**
 * Gate-row store — persists canonical evidence statements and their derived
 * gate-result/v1 predicate bodies alongside the content-addressed EvidenceBundle.
 *
 * The 8-step ingest worker content-addresses the EvidenceBundle (the manifest /
 * receipt) and records its key in the snapshot. The bundle is strict and carries
 * NO predicate bodies — so the rows the dashboard renders (decision, gate_name,
 * gate_reasons, coverage …) come from the manifest row's `evidencePayload`
 * (or legacy `gateResults`). Both statements and bodies are stored under the
 * bundle content key within the verified source repo namespace so readers can recheck the complete signed binding.
 *
 * The production writer stores rows only after verification. The store itself
 * is not a trust boundary: every production reader re-validates a stored body
 * against its signed bundle before rendering it.
 */

import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** The gate-result bodies for one verified bundle, plus the source repo. */
export interface StoredGateRows {
  /** Source repo key (one of the ingest repos) — drives render-time visibility. */
  readonly repo: string;
  /** The gate-result/v1 predicate bodies (snake_case, as emitted). */
  readonly bodies: readonly unknown[];
  /** Canonical statements retained for digest and metadata checks at read time. */
  readonly evidencePayload?: unknown;
  /**
   * Rekor log indices read off the row's ALREADY-VERIFIED sigstore bundle.
   *
   * The signed `EvidenceBundle.rekor_log_indices` cannot carry the anchor (the
   * bundle bytes are the signed blob, so the index post-dates them), so the
   * transparency-log position travels here instead — written only by the live
   * pass, only after the ingest worker verified the whole manifest.
   *
   * Optional: rows persisted before this field existed read back `undefined`,
   * which renders as "no anchor recorded" — never as a fabricated index.
   */
  readonly rekorLogIndices?: readonly number[];
}

/** Persist rows under their verified source repo; reads require caller repo context. */
export interface GateRowStore {
  put(bundleKey: string, rows: StoredGateRows): Promise<void>;
  get(bundleKey: string, repo: string): Promise<StoredGateRows | null>;
}

/** In-memory store (one-shot ingest runs + tests). */
export class MemoryGateRowStore implements GateRowStore {
  private readonly map = new Map<string, StoredGateRows>();
  put(bundleKey: string, rows: StoredGateRows): Promise<void> {
    this.map.set(scopedKey(bundleKey, rows.repo), rows);
    return Promise.resolve();
  }
  get(bundleKey: string, repo: string): Promise<StoredGateRows | null> {
    return Promise.resolve(this.map.get(scopedKey(bundleKey, repo)) ?? null);
  }
}

/** Validate path components for both stores; unknown safe repo names remain Tier-2. */
function scopedKey(bundleKey: string, repo: string): string {
  const hex = bundleKey.startsWith('sha256:') ? bundleKey.slice(7) : bundleKey;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}(?![\s\S])/.test(repo) || !/^[a-f0-9]{64}(?![\s\S])/.test(hex)) {
    throw new Error('Invalid gate-row repository or bundle key');
  }
  return `${repo}/${hex}`;
}

/**
 * Repo-scoped v2 sidecars. Legacy files are read only when v2 is absent and
 * the recorded repo matches. No writes modify the legacy namespace.
 * Atomic rename prevents readers observing an incomplete replacement. It is
 * not a transaction with the separately committed ingest snapshot.
 */
export class FsGateRowStore implements GateRowStore {
  constructor(private readonly root: string) {}

  private path(bundleKey: string, repo: string): string {
    return join(this.root, 'gate-rows', 'v2', `${scopedKey(bundleKey, repo)}.json`);
  }

  async put(bundleKey: string, rows: StoredGateRows): Promise<void> {
    const path = this.path(bundleKey, rows.repo);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(rows), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
  }

  async get(bundleKey: string, repo: string): Promise<StoredGateRows | null> {
    const path = this.path(bundleKey, repo);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
      const hex = scopedKey(bundleKey, repo).split('/')[1]!;
      try {
        text = await readFile(join(this.root, 'gate-rows', `${hex}.json`), 'utf8');
      } catch (legacyError: unknown) {
        if (isMissing(legacyError)) return null;
        throw legacyError;
      }
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
      parsed.repo !== repo ||
      !('bodies' in parsed) ||
      !Array.isArray(parsed.bodies)
    ) {
      return null;
    }
    // Optional anchor: read back only when it is a well-formed list of
    // non-negative integer log indices; anything else is dropped (no anchor
    // rendered), never coerced into a fabricated index.
    const indices = 'rekorLogIndices' in parsed ? parsed.rekorLogIndices : undefined;
    if (
      Array.isArray(indices) &&
      indices.every((n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)
    ) {
      return {
        repo: parsed.repo,
        bodies: parsed.bodies,
        ...('evidencePayload' in parsed ? { evidencePayload: parsed.evidencePayload } : {}),
        rekorLogIndices: indices as number[],
      };
    }
    return {
      repo: parsed.repo,
      bodies: parsed.bodies,
      ...('evidencePayload' in parsed ? { evidencePayload: parsed.evidencePayload } : {}),
    };
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
