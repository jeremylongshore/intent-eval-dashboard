/**
 * Test fixtures for the results-browser module.
 *
 * Provides:
 *   - a kernel-schema-VALID EvidenceBundle payload builder (so the production
 *     ContentStoreBundleResolver re-validates it for real against the kernel);
 *   - a fixture {@link BundleResolver} that returns gate-result projections
 *     without crypto (for view-model / render / generate / C3 tests);
 *   - a fixture {@link GateRowSource} for exercising the production resolver;
 *   - helpers to build RenderInput / RenderRepoState quickly.
 */

import { canonicalJsonBytes, sha256Key } from '../../ingest/content-address.js';
import { type IngestSnapshot } from '../../ingest/interfaces.js';
import { type MemoryContentStore } from '../../ingest/storage-memory.js';
import { type RenderInput, type RenderRepoState } from '../../ingest/renderer.js';
import {
  type BundleResolver,
  type GateDecisionView,
  type ResolvedBundleRow,
} from '../row-model.js';
import { type GateRowProjection, type GateRowSource } from '../bundle-resolver.js';
import { type RowVisibility } from '../visibility.js';

export const GATE_RESULT_URI = 'https://evals.intentsolutions.io/gate-result/v1';
export const VALIDATION_URI = 'https://evals.intentsolutions.io/validation-result/v1';

/** A kernel-schema-valid EvidenceBundle payload. `overrides` tweak it per test. */
export function validBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '01890a5d-ac96-774b-bcce-b302099a8057',
    eval_run_id: '01890a5d-ac96-774b-bcce-b302099a8058',
    created_at: '2026-05-30T12:00:00.000Z',
    predicate_uri_set: [GATE_RESULT_URI],
    row_count: 1,
    subject_set: [{ name: 'j-rig:ci:gate-7-layer', digest: { sha256: 'a'.repeat(64) } }],
    storage_key: 'sha256:' + 'b'.repeat(64),
    signing_mode: 'rekor_production',
    rekor_log_indices: [1689291334],
    verification_status: 'verified',
    verification_last_checked_at: '2026-05-30T12:00:01.000Z',
    ...overrides,
  };
}

/** Content-key for a bundle's canonical bytes (matches the ingest content store). */
export function keyFor(bundle: Record<string, unknown>): string {
  return sha256Key(canonicalJsonBytes(bundle));
}

/** Build a one-row resolved-bundle projection. */
export function resolvedRow(
  opts: {
    predicateUri?: string;
    decision?: GateDecisionView;
    gateName?: string;
    evaluatedAt?: string;
    bundleCreatedAt?: string;
    rekorLogIndices?: readonly number[];
    visibility?: RowVisibility;
  } = {},
): ResolvedBundleRow {
  return {
    predicateUri: opts.predicateUri ?? GATE_RESULT_URI,
    decision: opts.decision ?? 'pass',
    gateName: opts.gateName ?? 'escape-scan',
    evaluatedAt: opts.evaluatedAt ?? '2026-05-30T11:59:00.000Z',
    bundleCreatedAt: opts.bundleCreatedAt ?? '2026-05-30T12:00:00.000Z',
    rekorLogIndices: opts.rekorLogIndices ?? [1689291334],
    visibility: opts.visibility ?? { tier: 'tier-1' },
  };
}

/**
 * A simple map-backed BundleResolver: bundleKey → resolved rows.
 * Keys absent from the map resolve to null (no-data hole).
 */
export class FixtureResolver implements BundleResolver {
  constructor(private readonly map: Map<string, readonly ResolvedBundleRow[]>) {}
  resolve(bundleKey: string): Promise<readonly ResolvedBundleRow[] | null> {
    return Promise.resolve(this.map.get(bundleKey) ?? null);
  }
}

/** Build a RenderRepoState for a repo with given bundle keys + optional stale. */
export function repoState(
  repo: string,
  opts: {
    bundleKeys?: readonly string[];
    ingestedAt?: string;
    staleSince?: string;
    nullSnapshot?: boolean;
  } = {},
): RenderRepoState {
  if (opts.nullSnapshot === true) {
    return {
      repo,
      snapshot: null,
      ...(opts.staleSince !== undefined ? { staleSince: opts.staleSince } : {}),
    };
  }
  const snapshot: IngestSnapshot = {
    repo,
    lastKnownGoodIngestedAt: opts.ingestedAt ?? '2026-05-30T12:00:05.000Z',
    sourceSha: 'a'.repeat(40),
    bundleKeys: opts.bundleKeys ?? [],
  };
  return {
    repo,
    snapshot,
    ...(opts.staleSince !== undefined ? { staleSince: opts.staleSince } : {}),
  };
}

/** Build a RenderInput from repo states. */
export function renderInput(
  repos: readonly RenderRepoState[],
  asOf = '2026-05-30T12:00:05.000Z',
): RenderInput {
  return { asOf, repos };
}

/** A GateRowSource backed by a map (for the production resolver test). */
export class FixtureGateRowSource implements GateRowSource {
  constructor(private readonly map: Map<string, readonly GateRowProjection[]>) {}
  rowsFor(bundleKey: string): Promise<readonly GateRowProjection[] | null> {
    return Promise.resolve(this.map.get(bundleKey) ?? null);
  }
}

/** Put a bundle into a MemoryContentStore and return its content key. */
export async function storeBundle(
  store: MemoryContentStore,
  bundle: Record<string, unknown>,
): Promise<string> {
  return store.put(canonicalJsonBytes(bundle));
}
