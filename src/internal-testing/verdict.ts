/**
 * The auto-verdict — the "what does this number MEAN" layer of the teaching
 * dashboard (Pillar 1, bead nr75.1).
 *
 * A gate-result/v1 row is data: a decision + structured reasons + a coverage
 * declaration. On its own it is a CSV cell. The verdict turns it into a
 * plain-English reading an operator can act on:
 *
 *   - a `kind` (good / watch / fail / error) the page colours,
 *   - a one-line `headline` ("Passing — meets the policy bar"),
 *   - a `whatToFix` list lifted straight from the row's `gate_reasons[]` (the
 *     producing tool already wrote the actionable list — we render it, never
 *     invent it).
 *
 * This function is PURE and total — it derives everything from the row, reads no
 * clock, and never throws. A malformed row degrades to the most conservative
 * reading (never a silent "good").
 */

import { type TestingRow } from './testing-row.js';

/** Verdict kind — maps 1:1 to the gate_decision enum, named for operators. */
export type VerdictKind = 'good' | 'watch' | 'fail' | 'error';

/** A derived, human-readable reading of one gate-result row. */
export interface Verdict {
  /** Coarse classification driving the page's colour + sort weight. */
  readonly kind: VerdictKind;
  /** Accessible text glyph (paired with `label` in `sr-only` on render). */
  readonly glyph: string;
  /** Short label ('good' | 'watch' | 'fail' | 'error'). */
  readonly label: string;
  /** One-line plain-English reading of the decision. */
  readonly headline: string;
  /**
   * The actionable fix list. Sourced verbatim from the row's `gate_reasons[]`
   * (the producing tool's own "here is exactly what failed"). Empty for an
   * unconditional pass.
   */
  readonly whatToFix: readonly string[];
}

/** Severity weight so a page can sort the loudest problems to the top. */
export const VERDICT_WEIGHT: Readonly<Record<VerdictKind, number>> = {
  fail: 0,
  error: 1,
  watch: 2,
  good: 3,
};

/**
 * Derive the verdict for a single gate-result row.
 *
 * Mapping (fail-loud, never a silent pass):
 *   - `pass`     → good. No fixes. If the row marked dimensions NOT_APPLICABLE
 *                  (pass + populated `dimensions_skipped`), that is surfaced as
 *                  context on the page from `coverage`, not as a "fix".
 *   - `advisory` → watch. Reasons become the (non-blocking) attention list;
 *                  `advisory_severity` colours the headline.
 *   - `fail`     → fail. Reasons become the fix list (the schema requires ≥1).
 *   - `error`    → error. The gate could not evaluate; reasons[0] is the error
 *                  class. An error is NOT a pass and NOT a fail — it is "we do
 *                  not know", rendered as loudly as a fail.
 *   - anything else → error (fail-closed).
 */
export function deriveVerdict(row: TestingRow): Verdict {
  const reasons = row.gateReasons.filter((r) => r.trim().length > 0);

  switch (row.decision) {
    case 'pass':
      return {
        kind: 'good',
        glyph: '✓',
        label: 'good',
        headline: 'Passing — meets the policy bar.',
        whatToFix: [],
      };

    case 'advisory': {
      const sev = row.advisorySeverity;
      const sevText = sev !== undefined ? ` (${sev})` : '';
      return {
        kind: 'watch',
        glyph: '!',
        label: 'watch',
        headline: `Advisory${sevText} — not blocking, but worth attention.`,
        whatToFix: reasons.length > 0 ? reasons : ['(advisory raised, but no reason was recorded)'],
      };
    }

    case 'fail': {
      const mode = row.failureMode !== undefined ? ` [failure mode: ${row.failureMode}]` : '';
      return {
        kind: 'fail',
        glyph: '✗',
        label: 'fail',
        headline: `Failing — below the policy bar.${mode}`,
        whatToFix: reasons.length > 0 ? reasons : ['(gate failed, but no reason was recorded)'],
      };
    }

    case 'error':
      return {
        kind: 'error',
        glyph: '⚠',
        label: 'error',
        headline: 'Could not evaluate — the gate errored. This is not a pass.',
        whatToFix: reasons.length > 0 ? reasons : ['(gate errored, but no error class was recorded)'],
      };

    default:
      // Unknown decision → fail-closed to error. Never treated as good.
      return {
        kind: 'error',
        glyph: '⚠',
        label: 'error',
        headline: 'Unrecognised gate decision — treated as "unknown", never as a pass.',
        whatToFix: reasons.length > 0 ? reasons : ['(unknown decision value)'],
      };
  }
}
