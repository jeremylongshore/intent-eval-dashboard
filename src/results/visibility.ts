/**
 * Per-row visibility-tier gating for the PUBLIC results render (DR-035 C2).
 *
 * This is the single, pure, tested function the public generator applies to
 * decide whether a gate-result row may appear in the anonymous `/results/`
 * output. The tailnet-internal operator view (bead puxu.9) is a SEPARATE
 * surface that shows everything; it is intentionally NOT built here. This file
 * only encodes the public-render rule.
 *
 * The three tiers (DR-035 C2 — CSO hybrid):
 *
 *   - **Tier 1** — eventually-public-with-embargo. Renders publicly ONCE its
 *     embargo (if any) has elapsed. A future `embargo_until` keeps it absent;
 *     a past/absent embargo lets it through.
 *   - **Tier 2** — internal-default. Renders publicly ONLY with an affirmative
 *     consent flag. Without consent it is ABSENT from public output (effectively
 *     404 — the row is never written to the public site).
 *   - **Tier 3** — case-by-case. NEVER renders publicly through this default
 *     path; it requires per-artifact GC review which is out of band. The public
 *     generator treats Tier 3 as absent.
 *
 * The function is deliberately conservative: anything it does not positively
 * recognise as publicly-renderable is treated as NOT publicly renderable
 * (fail-closed). An unknown tier value is never surfaced.
 */

/** The closed visibility-tier set (DR-035 C2). */
export type VisibilityTier = 'tier-1' | 'tier-2' | 'tier-3';

/**
 * The visibility metadata a row carries. Sourced from the row's own annotation
 * at ingest time (the producing repo tags its tier; consent is a separate,
 * explicit signal recorded by Intent Solutions, never inferred).
 */
export interface RowVisibility {
  /** Which tier the row's source falls under. */
  readonly tier: VisibilityTier;
  /**
   * Affirmative consent flag. ONLY meaningful for Tier 2. `true` means written
   * consent to surface publicly has been recorded. Absent / `false` => no
   * consent.
   */
  readonly consent?: boolean;
  /**
   * RFC-3339 embargo expiry. ONLY meaningful for Tier 1. While `now < embargo
   * Until` the row stays absent from public output; once it elapses (or is
   * absent) the Tier-1 row renders publicly.
   */
  readonly embargoUntil?: string;
}

/** Why a row was excluded from public output (for tests + audit logging). */
export type PublicExclusionReason =
  | 'tier-2-no-consent'
  | 'tier-3-case-by-case'
  | 'tier-1-under-embargo'
  | 'unknown-tier';

/** Result of the public-visibility decision for one row. */
export type PublicVisibilityDecision =
  | { readonly public: true }
  | { readonly public: false; readonly reason: PublicExclusionReason };

/**
 * Decide whether a single row may appear in the ANONYMOUS public render.
 *
 * Pure + total: same inputs always yield the same decision; every code path
 * returns. `nowIso` is injected so embargo evaluation is deterministic in
 * tests (no hidden `Date.now()`).
 *
 * Fail-closed: any tier the function does not explicitly recognise as
 * publicly-renderable is excluded.
 */
export function decidePublicVisibility(
  visibility: RowVisibility,
  nowIso: string,
): PublicVisibilityDecision {
  switch (visibility.tier) {
    case 'tier-1': {
      // Eventually-public. Absent embargo => public now. Past embargo => public.
      // Future embargo => absent until it elapses.
      if (visibility.embargoUntil !== undefined && isFuture(visibility.embargoUntil, nowIso)) {
        return { public: false, reason: 'tier-1-under-embargo' };
      }
      return { public: true };
    }
    case 'tier-2': {
      // Internal-default. Renders publicly ONLY with affirmative consent.
      if (visibility.consent === true) {
        return { public: true };
      }
      return { public: false, reason: 'tier-2-no-consent' };
    }
    case 'tier-3': {
      // Case-by-case — never via the default public path.
      return { public: false, reason: 'tier-3-case-by-case' };
    }
    default: {
      // Unknown / malformed tier — fail closed.
      return { public: false, reason: 'unknown-tier' };
    }
  }
}

/** True if `whenIso` is strictly after `nowIso` (both RFC-3339). */
function isFuture(whenIso: string, nowIso: string): boolean {
  const when = Date.parse(whenIso);
  const now = Date.parse(nowIso);
  // If either timestamp is unparseable, fail closed by treating the embargo as
  // still in force (a malformed embargo must not leak the row).
  if (Number.isNaN(when) || Number.isNaN(now)) return true;
  return when > now;
}

/**
 * Filter a list of rows to ONLY those publicly renderable, in input order.
 *
 * This is the function the public generator calls before writing any row to the
 * site. The excluded rows are simply absent (no placeholder, no 404 page is
 * generated for them — they do not exist on the public surface).
 *
 * @typeParam T  the row type, which must expose its `visibility`.
 */
export function filterPubliclyVisible<T extends { readonly visibility: RowVisibility }>(
  rows: readonly T[],
  nowIso: string,
): T[] {
  return rows.filter((row) => decidePublicVisibility(row.visibility, nowIso).public);
}
