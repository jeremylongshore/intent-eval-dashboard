/**
 * Live ingest pass — drive the verified 8-step worker over every source repo,
 * then persist each verified row's gate-result bodies for the renderers.
 *
 * This is the orchestration the VPS cron (and the local proof run) calls. It
 * REUSES the security-critical {@link runIngestWorker} for fetch + OIDC + Rekor +
 * DSSE + schema + content-address + snapshot — it does NOT re-implement any
 * verification. After a repo's worker succeeds, the SAME verified manifest (held
 * by a caching fetcher so there is no second network round-trip) is walked to
 * persist each row's `gateResults` bodies under the row's bundle content key.
 *
 * The result is a {@link RenderInput} (built from the snapshot store) plus a
 * populated {@link GateRowStore} — exactly what the public + internal generators
 * consume. A repo whose worker crashes (no manifest, bad signature, etc.) is
 * recorded as not-fresh; the renderer then shows its prior snapshot or a loud
 * no-data state. Verify-before-render holds throughout.
 */

import { canonicalJsonBytes, sha256Key } from './content-address.js';
import { type GateRowStore } from './gate-row-store.js';
import {
  type ContentStore,
  type IngestClock,
  type ManifestFetcher,
  type SigstoreVerifier,
  type SnapshotStore,
} from './interfaces.js';
import { isIngestCrash } from './reason.js';
import { type ReportManifest } from './manifest.js';
import { type PinnedSubjects } from './oidc-allowlist.js';
import { buildRenderInput, type RenderInput, type RepoPassOutcome } from './renderer.js';
import { runIngestWorker } from './worker.js';

/** A fetcher that records the last manifest it returned per repo (no re-fetch). */
export class CachingManifestFetcher implements ManifestFetcher {
  private readonly cache = new Map<string, ReportManifest>();
  constructor(private readonly inner: ManifestFetcher) {}
  async fetch(repo: string): Promise<ReportManifest> {
    const m = await this.inner.fetch(repo);
    this.cache.set(repo, m);
    return m;
  }
  /** The manifest most recently fetched for `repo`, or undefined. */
  cached(repo: string): ReportManifest | undefined {
    return this.cache.get(repo);
  }
}

/** Everything a live pass needs (all injectable for tests + the local proof). */
export interface LivePassDeps {
  readonly fetcher: ManifestFetcher;
  readonly verifier: SigstoreVerifier;
  readonly contentStore: ContentStore;
  readonly snapshotStore: SnapshotStore;
  readonly gateRowStore: GateRowStore;
  readonly clock: IngestClock;
  readonly pinned: PinnedSubjects;
}

/** Outcome of a live pass: the render input + per-repo fresh/crashed outcomes. */
export interface LivePassResult {
  readonly input: RenderInput;
  readonly outcomes: readonly RepoPassOutcome[];
}

/** A manifest row carries the additive `gateResults` bodies (emit-side field). */
interface ManifestRowWithBodies {
  readonly bundle: unknown;
  readonly gateResults?: readonly unknown[];
}

/**
 * Run one ingest pass over `repos`, returning the RenderInput + outcomes.
 *
 * For each repo: run the verified worker; on success, persist the verified
 * manifest's per-row gate-result bodies into the gate-row store keyed by the
 * row's bundle content key (the same sha256 the worker content-addressed).
 */
export async function runLivePass(
  deps: LivePassDeps,
  repos: readonly string[],
): Promise<LivePassResult> {
  const fetcher = new CachingManifestFetcher(deps.fetcher);
  const workerDeps = { ...deps, fetcher };
  const outcomes: RepoPassOutcome[] = [];

  for (const repo of repos) {
    try {
      await runIngestWorker(repo, workerDeps);
      // Verified: persist the gate-result bodies for each row under its bundle key.
      const manifest = fetcher.cached(repo);
      /* v8 ignore next -- worker success implies the fetch cached a manifest */
      if (manifest !== undefined) {
        for (const row of manifest.rows as readonly ManifestRowWithBodies[]) {
          const bodies = row.gateResults ?? [];
          if (bodies.length === 0) continue;
          const bundleKey = sha256Key(canonicalJsonBytes(row.bundle));
          await deps.gateRowStore.put(bundleKey, { repo, bodies });
        }
      }
      outcomes.push({ repo, fresh: true });
    } catch (err: unknown) {
      // A worker crash is the verify-before-render fail-closed path: record
      // not-fresh + the structured reason; the renderer keeps the prior snapshot.
      if (isIngestCrash(err)) {
        outcomes.push({
          repo,
          fresh: false,
          failure: { step: err.reason.step, reasonCode: err.reason.reasonCode },
        });
      } else {
        /* v8 ignore next 2 -- defensive: any non-crash throw is still not-fresh */
        outcomes.push({ repo, fresh: false });
      }
    }
  }

  const input = await buildRenderInput(deps.snapshotStore, outcomes, deps.clock.nowIso());
  return { input, outcomes };
}
