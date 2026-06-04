/**
 * Ops-lite alert evaluator (amber-lighthouse Epic 2.8 / puxu.11).
 *
 * ── The ONE hard binding this module enforces (DR-035 § 8) ──
 *
 *   7-DAY-SILENCE IS THE ONLY PAGING TRIGGER.
 *
 * CISO binding: a source whose last *successful* verified ingest is more than 7
 * days old pages — at ntfy `critical`. CFO refusal: there is NO other pager.
 * There is no latency pager, no error-rate pager, no per-decision-threshold
 * pager, no "fail spike" pager. A source that is erroring its head off but has
 * a fresh successful ingest within the window does NOT page. The single signal
 * that the dashboard is structurally broken — a source has gone DARK — is the
 * only thing worth waking a single operator for.
 *
 * This is the pure, deterministic core. It takes the per-source liveness (the
 * SAME ingest-snapshot/liveness shape the freshness USE model consumes, extended
 * with the `lastSuccessfulIngestIso` the 7d rule needs) plus an INJECTED `now`.
 * The repo forbids wall-clock nondeterminism in tested logic, so `now` is a
 * parameter — never `Date.now()`. No I/O, no clock read, no transport. The
 * push side lives in `ntfy.ts`; the wiring lives in `scripts/check-liveness-alerts.ts`.
 *
 * Boundary (documented + tested):
 *   silentMs = now - lastSuccessfulIngest
 *   alerts IFF silentMs  >  SEVEN_DAYS_MS   (STRICTLY greater)
 *   does NOT alert when   silentMs === SEVEN_DAYS_MS  (exactly 7d is the edge of
 *                                                      the tolerated window).
 * So a source last seen exactly 7 days ago is the last non-paging state; one
 * millisecond more silence pages.
 */

/** Milliseconds in the 7-day silence threshold — the ONLY paging boundary. */
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Per-source liveness fact the alert evaluator consumes.
 *
 * This is the same ingest-liveness data the freshness USE model
 * (`src/freshness/use-model.ts` `RepoLiveness`) is built from, narrowed to the
 * single field the 7d rule needs — the last *successful* verified ingest time —
 * plus optional descriptive fields the evaluator IGNORES for the paging decision
 * but carries through so a caller can correlate (e.g. a current error). The
 * `currentError` field exists precisely to PROVE that nothing other than
 * 7d-silence influences the page: `evaluateLivenessAlerts` never reads it, so an
 * error never flips the gate (asserted in evaluate.test.ts only-trigger cases).
 */
export interface SourceLiveness {
  /** The source repo key (e.g. `iec`, `iel`, `iah`, `iaj`, `iar`, `ccp`). */
  readonly repo: string;
  /**
   * RFC-3339 timestamp of this source's most recent SUCCESSFUL verified ingest,
   * or `undefined` if it has NEVER produced a verified snapshot. `undefined`
   * means "infinitely silent" → it pages (a source that has never been seen is
   * more than 7 days silent by definition).
   */
  readonly lastSuccessfulIngestIso?: string;
  /**
   * Optional: a current failure on this source (e.g. a verification crash this
   * pass). Carried for correlation ONLY — it is NEVER an input to the paging
   * decision. A source with a fresh successful ingest does not page even if this
   * is set. Present so tests can prove the only-trigger binding.
   */
  readonly currentError?: { readonly step: string; readonly reasonCode: string };
}

/** A single critical alert: one silent source that crossed the 7d threshold. */
export interface CriticalAlert {
  readonly repo: string;
  /**
   * RFC-3339 of the last successful ingest, or `undefined` if the source has
   * never been seen (never produced a verified snapshot).
   */
  readonly lastSuccessfulIngestIso?: string;
  /**
   * Whole days the source has been silent (floor of silentMs / 1 day).
   * `Infinity` when the source has never been seen.
   */
  readonly daysSilent: number;
  /** Milliseconds of silence at `now` (Infinity when never seen). */
  readonly silentMs: number;
}

/** The result of one evaluation pass. */
export interface AlertEvaluation {
  /** The render's "now" (RFC-3339), echoed for traceability. */
  readonly nowIso: string;
  /**
   * The sources that crossed the 7d-silence threshold and MUST page, sorted
   * most-silent first (so the operator sees the worst at the top). Empty ⇒
   * nothing pages this pass.
   */
  readonly critical: readonly CriticalAlert[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the silence (in ms) of one source at `nowMs`.
 *
 * `undefined` last-ingest ⇒ `Infinity` (never seen = infinitely silent). An
 * unparseable timestamp is treated the SAME as never-seen (`Infinity`) — a
 * broken/garbage timestamp must FAIL CLOSED into "this source is dark", never
 * silently into "fresh". A timestamp in the FUTURE (clock skew) yields a
 * negative-then-clamped silence of 0 (cannot be silent for a negative duration);
 * it will not page.
 */
function silenceMs(lastIso: string | undefined, nowMs: number): number {
  if (lastIso === undefined) return Number.POSITIVE_INFINITY;
  const lastMs = Date.parse(lastIso);
  if (Number.isNaN(lastMs)) return Number.POSITIVE_INFINITY; // fail-closed
  return Math.max(0, nowMs - lastMs);
}

/**
 * Evaluate which sources have been silent for MORE than 7 days and must page.
 *
 * @param liveness  per-source last-successful-ingest facts.
 * @param nowIso    the injected "now" (RFC-3339). NEVER read from the clock here.
 *
 * The ONLY rule: `silentMs > SEVEN_DAYS_MS`. A source within 7 days (inclusive
 * of exactly 7 days) does not page, regardless of any `currentError`. The
 * returned `critical` list is sorted most-silent-first.
 *
 * Fail-closed clock: an unparseable `nowIso` anchors `now` at epoch 0 so EVERY
 * real source reads as future-dated (silence clamps to 0) and NOTHING pages —
 * we must never emit a critical page off a garbage clock, and we must never
 * silently treat a garbage clock as "all dark" (which would page everything).
 * The honest behavior on a broken clock is "I cannot tell, so I do not page";
 * the broken clock itself surfaces elsewhere (the freshness strip fails closed
 * to all-no-data, which is loud on /status).
 */
export function evaluateLivenessAlerts(
  liveness: readonly SourceLiveness[],
  nowIso: string,
): AlertEvaluation {
  const parsedNow = Date.parse(nowIso);
  const nowMs = Number.isNaN(parsedNow) ? 0 : parsedNow;

  const critical: CriticalAlert[] = [];
  for (const source of liveness) {
    const silent = silenceMs(source.lastSuccessfulIngestIso, nowMs);
    // STRICTLY greater than 7 days. Exactly 7d is the last non-paging state.
    if (silent > SEVEN_DAYS_MS) {
      critical.push({
        repo: source.repo,
        ...(source.lastSuccessfulIngestIso !== undefined
          ? { lastSuccessfulIngestIso: source.lastSuccessfulIngestIso }
          : {}),
        daysSilent: Number.isFinite(silent)
          ? Math.floor(silent / DAY_MS)
          : Number.POSITIVE_INFINITY,
        silentMs: silent,
      });
    }
  }

  // Most-silent first; Infinity (never seen) sorts to the top.
  critical.sort((a, b) => b.silentMs - a.silentMs);

  return { nowIso, critical };
}
