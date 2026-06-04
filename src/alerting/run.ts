/**
 * Alert-pass orchestrator (puxu.11) — the pure evaluate → format → push wiring.
 *
 * Extracted from the CLI so the whole flow is unit-tested with NO clock and NO
 * real push: it takes the per-source liveness, an injected `now`, and an
 * injected `NtfyTransport`. The CLI (`scripts/check-liveness-alerts.ts`) is then
 * the thin shell that reads the real clock, loads real liveness, picks the
 * (default no-op) transport, and logs the summary.
 *
 * Binding it enforces by construction: it only formats + pushes when the
 * evaluator returned at least one critical (7d-silence) alert — it can never
 * page on an empty list, because `formatCriticalMessage` is only reached when
 * `critical.length > 0`.
 */

import { evaluateLivenessAlerts, type SourceLiveness } from './evaluate.js';
import { formatCriticalMessage, type NtfyTransport } from './ntfy.js';

/** A compact summary of one alert pass, for the CLI to log. */
export interface AlertPassSummary {
  /** Number of sources that crossed the 7d-silence threshold. */
  readonly critical: number;
  /** Whether the push was actually delivered (false with the no-op default). */
  readonly delivered: boolean;
  /** Human-readable note from the (no-)push. */
  readonly note: string;
}

/**
 * Run one alert pass: evaluate → (only if any silent>7d) format + push.
 *
 * @param liveness   per-source last-successful-ingest facts.
 * @param nowIso     injected "now" (RFC-3339); never a clock read here.
 * @param transport  the push seam (default no-op-that-logs at the call site).
 */
export async function runAlertPass(
  liveness: readonly SourceLiveness[],
  nowIso: string,
  transport: NtfyTransport,
): Promise<AlertPassSummary> {
  const evaluation = evaluateLivenessAlerts(liveness, nowIso);
  if (evaluation.critical.length === 0) {
    return { critical: 0, delivered: false, note: 'no source silent > 7 days — nothing to page' };
  }
  const message = formatCriticalMessage(evaluation);
  const result = await transport.push(message);
  return { critical: evaluation.critical.length, delivered: result.delivered, note: result.note };
}
