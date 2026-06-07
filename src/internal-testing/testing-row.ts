/**
 * Testing-results view-model — the bridge from the verified ingest snapshot to
 * the renderable per-gate teaching rows (Pillar 1, bead nr75.1).
 *
 * This is the teaching-surface analogue of `src/results/row-model.ts`. Two
 * deliberate differences from the public results row-model:
 *
 *   1. **Richer projection.** The public row keeps a MINIMAL projection
 *      (decision + gate name + timestamps) because the public browser only
 *      tabulates outcomes. The teaching surface needs the fields that let it
 *      *explain*: `gate_reasons[]` (the what-to-fix list), `coverage`
 *      (what was / wasn't measured), `gate_version`, and the optional
 *      `failure_mode` / `advisory_severity`. So {@link ResolvedTestingRow}
 *      carries the gate-result/v1 body more completely.
 *
 *   2. **No visibility filter, no tier annotation.** The testing dashboard is a
 *      single GATED surface (basicauth — see the design DR + the successor-DR
 *      addendum to DR-035 § 8). Every verified row is shown to an authenticated
 *      operator; there is no public/internal split to compute here. (The
 *      separate tailnet-only operator-RESULTS view in `src/results/` keeps its
 *      per-tier visibility annotations; that surface is untouched.)
 *
 * Verify-before-render is preserved end to end exactly as in the results lane:
 * the only bundles a {@link TestingBundleResolver} can return are ones the
 * ingest worker already content-addressed AFTER full verification. There is no
 * path from a raw/unverified manifest into this model.
 */

import { type RenderInput, type RenderRepoState } from '../ingest/renderer.js';

/** A gate decision verdict (mirrors the kernel gate-result/v1 closed enum). */
export type GateDecision = 'pass' | 'fail' | 'advisory' | 'error';

/** Coverage declaration (kernel `_common` coverage: both arrays required). */
export interface CoverageDecl {
  readonly dimensionsEvaluated: readonly string[];
  readonly dimensionsSkipped: readonly string[];
}

/**
 * The richer gate-result/v1 projection one verified bundle yields, per row.
 *
 * This is the shape a {@link TestingBundleResolver} returns. It is the teaching
 * projection of the gate-result/v1 predicate body: enough to explain, verdict,
 * and list fixes — never the raw signature material (that stays in the verified
 * ingest layer).
 */
export interface ResolvedTestingRow {
  /** Canonical predicate URI (e.g. .../gate-result/v1). */
  readonly predicateUri: string;
  /** Pipeline-hop-qualified gate id (gate-result/v1 `gate_id`). */
  readonly gateId: string;
  /** Short kebab-case gate name (gate-result/v1 `gate_name`). */
  readonly gateName: string;
  /** SemVer of the gate logic (gate-result/v1 `gate_version`). */
  readonly gateVersion: string;
  /** The gate decision verdict. */
  readonly decision: GateDecision;
  /** Structured reason strings (gate-result/v1 `gate_reasons`) — the fix list. */
  readonly gateReasons: readonly string[];
  /** Coverage declaration (what was / wasn't measured). */
  readonly coverage: CoverageDecl;
  /** RFC-3339 `evaluated_at` from the gate-result/v1 body (timestamp #1). */
  readonly evaluatedAt: string;
  /** RFC-3339 EvidenceBundle.created_at (timestamp #2). */
  readonly bundleCreatedAt: string;
  /** Rekor transparency-log indices anchoring the bundle (timestamp #3 source). */
  readonly rekorLogIndices: readonly number[];
  /** Failure-mode classifier, when decision='fail' and the tool defines modes. */
  readonly failureMode?: string;
  /** Severity hint when decision='advisory'. */
  readonly advisorySeverity?: 'info' | 'warn' | 'error';
}

/**
 * Resolves verified EvidenceBundle bodies by their content-addressed key into
 * the richer testing-row projection.
 *
 * Production impl (Phase 2, wired with the emit + ingest work) wraps the ingest
 * ContentStore + kernel EvidenceBundle validator; the test impl is an in-memory
 * map. Returning `null` means the key is unknown — a no-data hole, never a pass.
 */
export interface TestingBundleResolver {
  resolve(bundleKey: string): Promise<readonly ResolvedTestingRow[] | null>;
}

/** A renderable testing row, carrying repo + bundle identity + ingest time. */
export interface TestingRow extends ResolvedTestingRow {
  /** Repo key (one of the ingest repos). */
  readonly repo: string;
  /** Content-addressed bundle key (stable deep-link identity). */
  readonly bundleKey: string;
  /** Index of this row within its bundle (disambiguation). */
  readonly rowIndex: number;
  /** RFC-3339 ingest time of the snapshot this row came from (timestamp #4). */
  readonly ingestedAt: string;
}

/** One repo's renderable testing state (rows + freshness). */
export interface TestingRepo {
  readonly repo: string;
  /** Verified rows for this repo. EMPTY → loud no-data (never a pass). */
  readonly rows: readonly TestingRow[];
  /** True when this repo currently has zero renderable rows (no-data). */
  readonly noData: boolean;
  /** ISO timestamp staleness began, when serving a prior-good snapshot. */
  readonly staleSince?: string;
  /** ISO timestamp of the snapshot this repo's rows came from (ingested_at). */
  readonly ingestedAt?: string;
}

/** The full testing view across all repos. */
export interface TestingView {
  /** Global "as-of" = min(ingested_at) across repos that have a snapshot. */
  readonly asOf?: string;
  readonly repos: readonly TestingRepo[];
}

/**
 * Build one repo's renderable testing rows from its render state + a resolver.
 *
 * A repo with a null snapshot, an empty `bundleKeys`, or only unresolvable keys
 * yields `noData: true` + zero rows — the loud no-data state, never a synthetic
 * pass. Rows are flattened across bundle keys in (bundle, row) order so any
 * future deep link is stable.
 */
export async function buildTestingRepo(
  state: RenderRepoState,
  resolver: TestingBundleResolver,
): Promise<TestingRepo> {
  const snapshot = state.snapshot;
  const ingestedAt = snapshot?.lastKnownGoodIngestedAt;
  const rows: TestingRow[] = [];

  if (snapshot !== null && snapshot !== undefined) {
    for (const bundleKey of snapshot.bundleKeys) {
      const resolved = await resolver.resolve(bundleKey);
      if (resolved === null) continue; // unresolvable key => hole, not a pass
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        /* v8 ignore next -- index in range; guard only for noUncheckedIndexedAccess */
        if (r === undefined) continue;
        rows.push({
          ...r,
          repo: state.repo,
          bundleKey,
          rowIndex: i,
          ingestedAt: ingestedAt ?? '',
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
 * Build the full testing view from the renderer's {@link RenderInput}.
 *
 * `asOf` = min(ingested_at) across repos that have a snapshot — the staleness
 * floor of the whole page (Gregg binding, reused from the results lane).
 */
export async function buildTestingView(
  input: RenderInput,
  resolver: TestingBundleResolver,
): Promise<TestingView> {
  const repos: TestingRepo[] = [];
  for (const state of input.repos) {
    repos.push(await buildTestingRepo(state, resolver));
  }

  const ingestedTimes = repos
    .map((r) => r.ingestedAt)
    .filter((t): t is string => t !== undefined && t.length > 0);
  const asOf =
    ingestedTimes.length > 0 ? ingestedTimes.reduce((min, t) => (t < min ? t : min)) : undefined;

  return { ...(asOf !== undefined ? { asOf } : {}), repos };
}
