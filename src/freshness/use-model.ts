/**
 * USE-method observability of the INGEST PIPELINE ITSELF (puxu.7 / Epic 2.4).
 *
 * Brendan Gregg's USE method (Utilization / Saturation / Errors) applied not to
 * the per-repo evaluation results (that is the decision-mix strip in
 * `bucket-model.ts`) but to the 8-worker ingest pipeline as a SYSTEM. This is
 * the data behind the `/status` route: "is the machine that produces the
 * dashboard healthy?", distinct from "what do the evals say?".
 *
 * The three USE analogues for the ingest supervision tree:
 *
 *   U — Utilization: the fraction of the 8 ingest workers that produced a FRESH
 *       verified snapshot this pass. `freshWorkers / totalWorkers`. A worker
 *       serving only a prior-good (stale) snapshot is NOT counted as utilized —
 *       it is doing no useful new work this pass.
 *
 *   S — Saturation: restart / back-off pressure on the supervision tree. We use
 *       the total restart count in the window as the saturation signal (an OTP
 *       supervisor restarting a transient worker is the queue-depth analogue:
 *       work is backing up against the restart budget). Reported as a raw count
 *       plus a normalized pressure ratio against the aggregate restart budget,
 *       and an `escalated` flag when any child blew its budget (the supervisor
 *       gave up — maximum saturation).
 *
 *   E — Errors: verification / crash failures in the window — the count of
 *       workers that crashed this pass (failed OIDC/Rekor/DSSE/schema
 *       verification, or otherwise exited abnormally), with their structured
 *       reasons preserved for the operator.
 *
 * This module is pure: it derives the USE view from a snapshot of supervision +
 * freshness state. No I/O, no clock — the inputs already carry timestamps.
 */

import { type FreshnessStripView, type RepoFreshnessRow } from './bucket-model.js';

/** A per-repo freshness fact the USE model consumes for Utilization. */
export interface RepoLiveness {
  readonly repo: string;
  /** True ⇔ this worker produced a fresh verified snapshot this pass. */
  readonly fresh: boolean;
  /** Set when serving a prior-good snapshot (stale). Informational. */
  readonly staleSince?: string;
  /** Structured failure when this worker crashed this pass. */
  readonly failure?: { readonly step: string; readonly reasonCode: string };
}

/** A restart/escalation summary from the supervision report. */
export interface SupervisionPressure {
  /** Total restarts recorded in the window across all ingest workers. */
  readonly restartCount: number;
  /**
   * The aggregate restart budget the supervisor would tolerate before
   * escalating, used only to normalize the pressure ratio. Per the deploy tree
   * this is `maxRestarts * workerCount` for the window. Must be > 0.
   */
  readonly restartBudget: number;
  /** Child ids that blew their budget and were given up on (escalated). */
  readonly escalatedChildIds: readonly string[];
}

/** Utilization component of the USE view. */
export interface UtilizationView {
  readonly freshWorkers: number;
  readonly totalWorkers: number;
  /** freshWorkers / totalWorkers in [0,1]. 0 when there are no workers. */
  readonly ratio: number;
  /** Repos serving only a prior-good (stale) snapshot this pass. */
  readonly staleRepos: readonly string[];
}

/** Saturation component of the USE view. */
export interface SaturationView {
  readonly restartCount: number;
  readonly restartBudget: number;
  /** restartCount / restartBudget, clamped to [0,1] (>=1 ⇒ budget pressure). */
  readonly pressureRatio: number;
  /** True if any child escalated (supervisor gave up) — maximal saturation. */
  readonly escalated: boolean;
  readonly escalatedChildIds: readonly string[];
}

/** Errors component of the USE view. */
export interface ErrorsView {
  /** Count of workers that crashed (verification/abnormal exit) this pass. */
  readonly crashCount: number;
  /** Per-repo crash detail, preserving the structured reason. */
  readonly crashes: readonly {
    readonly repo: string;
    readonly step: string;
    readonly reasonCode: string;
  }[];
}

/** The full USE view of the ingest pipeline. */
export interface IngestUseView {
  readonly nowIso: string;
  readonly utilization: UtilizationView;
  readonly saturation: SaturationView;
  readonly errors: ErrorsView;
  /**
   * The number of repos that are fully silent (every bucket no-data) across the
   * 24h freshness window — the count Gregg cares about most: sources the
   * dashboard has heard NOTHING verified from. Derived from the strip view.
   */
  readonly fullySilentRepos: readonly string[];
}

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Compute the USE view of the ingest pipeline.
 *
 * @param liveness  per-repo fresh/stale/crashed facts for THIS pass.
 * @param pressure  restart + escalation summary from the supervision report.
 * @param strip     the freshness-strip view (for the fully-silent-repos signal).
 * @param nowIso    the render's "now".
 *
 * Utilization counts only FRESH workers (stale = serving prior-good = no useful
 * new work). Saturation is restart pressure; escalation forces it to the top.
 * Errors are crashes with their structured reasons.
 */
export function computeIngestUse(
  liveness: readonly RepoLiveness[],
  pressure: SupervisionPressure,
  strip: FreshnessStripView,
  nowIso: string,
): IngestUseView {
  const totalWorkers = liveness.length;
  const freshWorkers = liveness.filter((l) => l.fresh).length;
  const staleRepos = liveness.filter((l) => l.staleSince !== undefined).map((l) => l.repo);

  const utilization: UtilizationView = {
    freshWorkers,
    totalWorkers,
    ratio: totalWorkers > 0 ? freshWorkers / totalWorkers : 0,
    staleRepos,
  };

  const budget = pressure.restartBudget > 0 ? pressure.restartBudget : 1;
  const saturation: SaturationView = {
    restartCount: pressure.restartCount,
    restartBudget: pressure.restartBudget,
    pressureRatio: clamp(pressure.restartCount / budget, 0, 1),
    escalated: pressure.escalatedChildIds.length > 0,
    escalatedChildIds: pressure.escalatedChildIds,
  };

  const crashing = liveness.filter(
    (l): l is RepoLiveness & { failure: NonNullable<RepoLiveness['failure']> } =>
      l.failure !== undefined,
  );
  const errors: ErrorsView = {
    crashCount: crashing.length,
    crashes: crashing.map((l) => ({
      repo: l.repo,
      step: l.failure.step,
      reasonCode: l.failure.reasonCode,
    })),
  };

  const fullySilentRepos = strip.rows
    .filter((r: RepoFreshnessRow) => r.allNoData)
    .map((r) => r.repo);

  return { nowIso, utilization, saturation, errors, fullySilentRepos };
}
