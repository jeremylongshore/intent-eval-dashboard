/**
 * Freshness + decision-mix bucket model (amber-lighthouse Epic 2.4 / puxu.7).
 *
 * This is the pure, deterministic core of the top-of-landing FRESHNESS STRIP:
 * one row per source repo (the 6 ingest repos), 24 columns = the last 24 hourly
 * buckets (a rolling 24h window ending at `nowIso`). Each bucket carries the
 * DECISION MIX of the verified gate-result rows whose `evaluated_at` falls in
 * that hour: counts of `{ pass, fail, advisory, error }` plus a derived
 * `no-data` state for an hour with zero verified rows.
 *
 * ── The load-bearing integrity binding (DR-035 C4 / Gregg / CMO addendum) ──
 *
 *   ABSENCE IS SHOWN LOUDLY, NEVER SILENTLY FILLED.
 *
 * An hour with no verified rows for a repo is `no-data`. It is NEVER:
 *   - carried forward from a prior hour's value,
 *   - inferred from an adjacent bucket,
 *   - rendered blank / neutral / grey-that-reads-as-ok, or
 *   - treated as a pass.
 *
 * This is realised structurally: a bucket's `kind` is `no-data` IFF its row
 * count is zero. There is no code path that copies a non-`no-data` value into an
 * empty bucket. The only inputs to a bucket are the rows whose timestamp lands
 * in that exact hour — nothing else.
 *
 * A repo with no verified snapshot at all (the realistic CURRENT state of the
 * platform — emit-evidence is incomplete upstream) therefore yields 24 `no-data`
 * buckets: the honest truth, rendered as loudly as 24 failures.
 *
 * This module is pure data + arithmetic — no I/O, no `Date.now()`. The clock is
 * injected as `nowIso` so the 24h window is deterministic in tests.
 */

import { type GateDecisionView } from '../results/row-model.js';

/** The closed set of decision kinds a bucket can hold, plus the derived hole. */
export type BucketKind = GateDecisionView | 'no-data';

/** One hour's decision mix for one repo. */
export interface DecisionBucket {
  /**
   * Inclusive start of the hour this bucket covers (RFC-3339, truncated to the
   * top of the hour, UTC). Buckets run [hourStart, hourStart + 1h).
   */
  readonly hourStartIso: string;
  /** Per-decision counts of verified rows that fell in this hour. */
  readonly counts: {
    readonly pass: number;
    readonly fail: number;
    readonly advisory: number;
    readonly error: number;
  };
  /** Total verified rows in this hour (sum of counts). 0 ⇔ no-data. */
  readonly total: number;
  /**
   * The bucket's dominant visual kind, which drives its color:
   *   - `no-data` when `total === 0` (LOUD — equal weight with fail);
   *   - otherwise the most-severe present decision by the precedence
   *     fail > error > advisory > pass (a single fail in an hour colors the
   *     hour as a failure — we never let a pass mask a fail).
   *
   * `no-data` is NEVER produced by carry-forward; it is produced ONLY by an
   * empty hour.
   */
  readonly kind: BucketKind;
}

/** One repo's row in the strip: its repo key + 24 ordered hourly buckets. */
export interface RepoFreshnessRow {
  readonly repo: string;
  /**
   * Exactly {@link BUCKET_COUNT} buckets, oldest → newest (left → right). The
   * last element is the bucket containing `nowIso`.
   */
  readonly buckets: readonly DecisionBucket[];
  /**
   * True when EVERY bucket in the window is `no-data`. Surfaced so the renderer
   * can stamp a loud whole-row no-data treatment (a fully-silent source).
   */
  readonly allNoData: boolean;
  /**
   * When the most-recent bucket is `no-data`, the RFC-3339 timestamp of the most
   * recent verified row for this repo in the window, or undefined if the repo
   * has been silent for the whole window. This is descriptive only — it is shown
   * as a "last seen" annotation; it is NEVER used to fill a bucket.
   */
  readonly lastSeenInWindowIso?: string;
}

/** The full strip view across all repos for one render. */
export interface FreshnessStripView {
  /** Inclusive end of the window (RFC-3339) — the render's "now". */
  readonly nowIso: string;
  /** Start of the window = nowIso truncated to the hour, minus 23h. */
  readonly windowStartIso: string;
  /** One row per repo, in the given repo order. */
  readonly rows: readonly RepoFreshnessRow[];
}

/** A single verified gate-result row, as the strip consumes it. */
export interface FreshnessRowInput {
  /** Which repo this row belongs to. */
  readonly repo: string;
  /** RFC-3339 `evaluated_at` — the time the gate decided (timestamp #1). */
  readonly evaluatedAt: string;
  /** The gate decision verdict. */
  readonly decision: GateDecisionView;
}

/** Number of hourly buckets in the window (the last 24 hours). */
export const BUCKET_COUNT = 24;

const HOUR_MS = 60 * 60 * 1000;

/** Truncate an epoch-ms instant to the top of its UTC hour. */
function floorToHourMs(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/** Decision-severity precedence: a worse decision colors the hour. */
const SEVERITY: readonly GateDecisionView[] = ['fail', 'error', 'advisory', 'pass'];

/**
 * Pick the bucket kind from a decision tally.
 *
 * `total === 0` ⇒ `no-data` (the loud hole). Otherwise the most-severe decision
 * actually present, so a single fail in an hour colors the hour as a failure and
 * a pass can never mask a worse sibling. This is a *coloring* rule, not an
 * aggregate metric — the per-decision counts remain available on the bucket and
 * are rendered in the tooltip; we never composite a PASS% across predicates here
 * (there is no predicate dimension in this strip at all — see C3 note below).
 */
function kindFromCounts(counts: DecisionBucket['counts'], total: number): BucketKind {
  if (total === 0) return 'no-data';
  for (const d of SEVERITY) {
    if (counts[d] > 0) return d;
  }
  /* v8 ignore next -- unreachable: total>0 guarantees one decision is present. */
  return 'no-data';
}

/**
 * Build one repo's 24-bucket row from its verified rows + the window.
 *
 * `windowStartMs` is the top-of-hour start of the FIRST (oldest) bucket. Each
 * row is placed into the bucket whose hour contains its `evaluated_at`; rows
 * outside the window are ignored. An empty bucket stays `no-data` — there is no
 * carry-forward step anywhere in this function.
 */
function buildRepoRow(
  repo: string,
  rows: readonly FreshnessRowInput[],
  windowStartMs: number,
): RepoFreshnessRow {
  // Initialise 24 empty buckets. Empty ⇒ no-data by construction.
  const tallies = Array.from({ length: BUCKET_COUNT }, () => ({
    pass: 0,
    fail: 0,
    advisory: 0,
    error: 0,
  }));

  let lastSeenMs = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    if (row.repo !== repo) continue;
    const ms = Date.parse(row.evaluatedAt);
    if (Number.isNaN(ms)) continue; // unparseable timestamp ⇒ ignored (a hole, not a pass)
    const idx = Math.floor((ms - windowStartMs) / HOUR_MS);
    if (idx < 0 || idx >= BUCKET_COUNT) continue; // outside the 24h window
    const tally = tallies[idx];
    /* v8 ignore next -- idx is bounds-checked above; guard for noUncheckedIndexedAccess. */
    if (tally === undefined) continue;
    tally[row.decision] += 1;
    if (ms > lastSeenMs) lastSeenMs = ms;
  }

  const buckets: DecisionBucket[] = tallies.map((counts, i) => {
    const total = counts.pass + counts.fail + counts.advisory + counts.error;
    return {
      hourStartIso: new Date(windowStartMs + i * HOUR_MS).toISOString(),
      counts,
      total,
      kind: kindFromCounts(counts, total),
    };
  });

  const allNoData = buckets.every((b) => b.kind === 'no-data');
  const mostRecent = buckets[BUCKET_COUNT - 1];
  /* v8 ignore next -- buckets always has BUCKET_COUNT entries. */
  const recentIsNoData = mostRecent === undefined || mostRecent.kind === 'no-data';

  return {
    repo,
    buckets,
    allNoData,
    ...(recentIsNoData && lastSeenMs !== Number.NEGATIVE_INFINITY
      ? { lastSeenInWindowIso: new Date(lastSeenMs).toISOString() }
      : {}),
  };
}

/**
 * Build the full freshness-strip view: one 24-bucket row per repo.
 *
 * @param repos     the source repos, in render order (the 6 ingest repos).
 * @param rows      verified gate-result rows across all repos (any that fall
 *                  outside the 24h window are ignored).
 * @param nowIso    the render's "now" (RFC-3339). The window is the 24 hours
 *                  ending at the top of `nowIso`'s hour.
 *
 * The window's last bucket is the one CONTAINING `nowIso` (so the right-most
 * column is "this hour"). Each repo with no rows in the window yields 24
 * `no-data` buckets — never filled, never blank.
 */
export function buildFreshnessStrip(
  repos: readonly string[],
  rows: readonly FreshnessRowInput[],
  nowIso: string,
): FreshnessStripView {
  const nowMs = Date.parse(nowIso);
  // Fail-closed on an unparseable clock: anchor the window at epoch 0 so EVERY
  // real row falls outside it ⇒ everything renders no-data. A broken clock must
  // never silently produce a "looks fine" strip.
  const safeNowMs = Number.isNaN(nowMs) ? 0 : nowMs;
  const currentHourStartMs = floorToHourMs(safeNowMs);
  // 24 buckets: the oldest starts 23 hours before the current hour.
  const windowStartMs = currentHourStartMs - (BUCKET_COUNT - 1) * HOUR_MS;

  return {
    nowIso,
    windowStartIso: new Date(windowStartMs).toISOString(),
    rows: repos.map((repo) => buildRepoRow(repo, rows, windowStartMs)),
  };
}
