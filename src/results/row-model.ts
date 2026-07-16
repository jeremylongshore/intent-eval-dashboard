/**
 * Results view-model — the bridge from the verified ingest snapshot to the
 * renderable `/results/` rows.
 *
 * The renderer's {@link RenderInput} (from `src/ingest/renderer.ts`) is the
 * INPUT seam: it carries, per repo, the LATEST VERIFIED snapshot (or the prior
 * good snapshot + `staleSince` when this pass crashed). A snapshot only holds
 * content-addressed bundle KEYS — not the bundle bodies — so to render rows we
 * resolve each key back to its verified EvidenceBundle payload through a
 * {@link BundleResolver} seam (backed in production by the ingest
 * `ContentStore`; backed in tests by an in-memory fixture map).
 *
 * Verify-before-render is preserved end to end: the only bundles a resolver can
 * return are the ones the ingest worker already content-addressed AFTER full
 * verification (steps 3-6). There is no path from a raw/unverified manifest into
 * this model.
 *
 * Each EvidenceBundle yields the 4-timestamp surface (Gregg binding):
 *   1. `evaluated_at`            — when the gate evaluated (gate-result/v1 body)
 *   2. `bundle_created_at`       — EvidenceBundle.created_at
 *   3. `rekor_anchored`          — the Rekor transparency-log anchor (indices)
 *   4. `ingested_at`             — when THIS dashboard verified + ingested it
 *
 * We never collapse these into one timestamp.
 */

import { type RenderInput, type RenderRepoState } from '../ingest/renderer.js';
import { type RowVisibility, type VisibilityTier } from './visibility.js';

/** A gate decision verdict (mirrors the kernel gate-result/v1 closed enum). */
export type GateDecisionView = 'pass' | 'fail' | 'advisory' | 'error';

/**
 * A single gate-result row as resolved from a verified EvidenceBundle.
 *
 * This is the shape a {@link BundleResolver} returns per bundle key. It is the
 * minimal projection of the gate-result/v1 predicate body + its enclosing
 * EvidenceBundle that the public surface renders. The producing repo annotates
 * the row's `visibility` (tier + consent/embargo) at emit time.
 */
export interface ResolvedBundleRow {
  /** Canonical predicate URI this row attests against (e.g. .../gate-result/v1). */
  readonly predicateUri: string;
  /** The gate decision verdict. */
  readonly decision: GateDecisionView;
  /** Short kebab-case gate name (gate-result/v1 `gate_name`). */
  readonly gateName: string;
  /** RFC-3339 `evaluated_at` from the gate-result/v1 body (timestamp #1). */
  readonly evaluatedAt: string;
  /** RFC-3339 EvidenceBundle.created_at (timestamp #2). */
  readonly bundleCreatedAt: string;
  /** Rekor transparency-log indices anchoring the bundle (timestamp #3 source). */
  readonly rekorLogIndices: readonly number[];
  /** Per-row visibility tier + consent/embargo (drives public gating). */
  readonly visibility: RowVisibility;
}

/**
 * Resolves verified EvidenceBundle bodies by their content-addressed key.
 *
 * Production impl wraps the ingest `ContentStore` + the kernel EvidenceBundle
 * Zod validator; test impl is an in-memory map. Returning `null` means the key
 * is unknown (treated as a no-data hole, never as a pass).
 */
export interface BundleResolver {
  /** Resolve one bundle key → its gate-result rows, or null if absent/unresolvable. */
  resolve(bundleKey: string): Promise<readonly ResolvedBundleRow[] | null>;
}

/** A renderable results row, carrying the full 4-timestamp surface. */
export interface ResultsRow {
  /** Repo key (one of the 8 ingest repos). */
  readonly repo: string;
  /** Content-addressed bundle key (stable deep-link identity). */
  readonly bundleKey: string;
  /** Index of this row within its bundle (deep-link disambiguation). */
  readonly rowIndex: number;
  readonly predicateUri: string;
  readonly decision: GateDecisionView;
  readonly gateName: string;
  /** The 4 distinct timestamps — never collapsed (Gregg binding). */
  readonly evaluatedAt: string;
  readonly bundleCreatedAt: string;
  readonly rekorLogIndices: readonly number[];
  readonly ingestedAt: string;
  readonly visibility: RowVisibility;
}

/** One repo's renderable results state (rows + freshness). */
export interface RepoResults {
  readonly repo: string;
  /**
   * The publicly-renderable rows for this repo. EMPTY when the repo has no
   * verified bundles yet (the realistic current state) — rendered as a loud
   * `no-data` state, NOT as a pass.
   */
  readonly rows: readonly ResultsRow[];
  /** True when this repo currently has zero renderable rows (no-data). */
  readonly noData: boolean;
  /** ISO timestamp staleness began, when serving a prior-good snapshot. */
  readonly staleSince?: string;
  /** ISO timestamp of the snapshot this repo's rows came from (ingested_at). */
  readonly ingestedAt?: string;
}

/** The full results view across all repos. */
export interface ResultsView {
  /**
   * Global "as-of" = min(ingested_at) across all repos that HAVE a snapshot in
   * this view. Undefined when no repo has any snapshot yet.
   */
  readonly asOf?: string;
  readonly repos: readonly RepoResults[];
}

/**
 * Default visibility for a row whose source did not annotate one.
 *
 * Fail-safe to the most restrictive PUBLIC posture: Tier 2 without consent =>
 * absent from public output. A row that forgot to declare its tier must never
 * default to publicly visible.
 */
const DEFAULT_VISIBILITY: RowVisibility = { tier: 'tier-2' };

/** Coerce an unknown tier string to a known tier, defaulting fail-closed. */
function coerceTier(tier: unknown): VisibilityTier {
  return tier === 'tier-1' || tier === 'tier-2' || tier === 'tier-3' ? tier : 'tier-2';
}

/** Normalise a resolved row's visibility, applying the fail-closed default. */
function normaliseVisibility(v: RowVisibility | undefined): RowVisibility {
  if (v === undefined) return DEFAULT_VISIBILITY;
  const tier = coerceTier(v.tier);
  return {
    tier,
    ...(v.consent !== undefined ? { consent: v.consent } : {}),
    ...(v.embargoUntil !== undefined ? { embargoUntil: v.embargoUntil } : {}),
  };
}

/**
 * Build one repo's renderable results from its render state + a resolver.
 *
 * Rows are flattened across the repo's bundle keys in (bundle, row) order so
 * deep links are stable. A repo with a null snapshot, an empty `bundleKeys`,
 * or only unresolvable keys yields `noData: true` + zero rows — the loud
 * no-data state, never a synthetic pass.
 *
 * NOTE: this does NOT apply public visibility filtering — that is a separate,
 * explicit step (`filterPubliclyVisible`) the public generator runs, so the
 * (future) tailnet-internal view can reuse the same builder without filtering.
 */
export async function buildRepoResults(
  state: RenderRepoState,
  resolver: BundleResolver,
): Promise<RepoResults> {
  const snapshot = state.snapshot;
  const ingestedAt = snapshot?.lastKnownGoodIngestedAt;
  const rows: ResultsRow[] = [];

  if (snapshot !== null && snapshot !== undefined) {
    for (const bundleKey of snapshot.bundleKeys) {
      const resolved = await resolver.resolve(bundleKey);
      if (resolved === null) continue; // unresolvable key => hole, not a pass
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        /* v8 ignore next -- index in range; guard only for noUncheckedIndexedAccess */
        if (r === undefined) continue;
        rows.push({
          repo: state.repo,
          bundleKey,
          rowIndex: i,
          predicateUri: r.predicateUri,
          decision: r.decision,
          gateName: r.gateName,
          evaluatedAt: r.evaluatedAt,
          bundleCreatedAt: r.bundleCreatedAt,
          rekorLogIndices: r.rekorLogIndices,
          ingestedAt: ingestedAt ?? '',
          visibility: normaliseVisibility(r.visibility),
        });
      }
    }
  }

  return {
    repo: state.repo,
    rows,
    noData: rows.length === 0,
    ...(state.staleSince !== undefined ? { staleSince: state.staleSince } : {}),
    ...(ingestedAt !== undefined ? { ingestedAt } : {}),
  };
}

/**
 * Build the full results view from the renderer's {@link RenderInput}.
 *
 * The `asOf` banner is `min(ingested_at)` across repos that have a snapshot —
 * the oldest ingest in the current view, so the banner is truthful about the
 * staleness floor of the whole page.
 */
export async function buildResultsView(
  input: RenderInput,
  resolver: BundleResolver,
): Promise<ResultsView> {
  const repos: RepoResults[] = [];
  for (const state of input.repos) {
    repos.push(await buildRepoResults(state, resolver));
  }

  const ingestedTimes = repos
    .map((r) => r.ingestedAt)
    .filter((t): t is string => t !== undefined && t.length > 0);
  const asOf =
    ingestedTimes.length > 0 ? ingestedTimes.reduce((min, t) => (t < min ? t : min)) : undefined;

  return { ...(asOf !== undefined ? { asOf } : {}), repos };
}
