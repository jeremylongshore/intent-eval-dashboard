/**
 * The supervisor runtime — drives the pure decisions in `strategy.ts`.
 *
 * Responsibilities:
 *   - run each child's `start()`, normalizing a thrown error into an abnormal
 *     `{ kind: 'crash' }` exit (a child MUST NOT take down the supervisor);
 *   - when a child terminates, consult `decide()` and act:
 *       none      → leave it terminated;
 *       restart   → re-run the affected ordered child set;
 *       escalate  → record an escalation and surface it (the supervisor gives
 *                   up on that child rather than infinite-looping).
 *   - record restart history (clock-injected for deterministic tests);
 *   - expose observability: per-child run counts, restart log, escalations,
 *     and the last exit reason per child (so the renderer can read
 *     `last_known_good_stale_since` from a crashed worker's structured reason).
 *
 * Concurrency model: children run concurrently (one_for_one isolation means an
 * independent child's crash must not touch its siblings). Restarts of an
 * affected set run sequentially in start order (rest_for_one ordering).
 */

import { decide } from './strategy.js';
import {
  type ChildSpec,
  type ExitReason,
  type RestartEvent,
  type SupervisionDecision,
  type SupervisorSpec,
} from './types.js';

/** Injectable monotonic-ish clock. Default = Date.now. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** An escalation surfaced to the parent supervisor / operator. */
export interface Escalation {
  readonly supervisorId: string;
  readonly childId: string;
  readonly reason: ExitReason;
  readonly atMs: number;
}

/** Observable result of running a supervisor to quiescence. */
export interface SupervisorReport {
  readonly supervisorId: string;
  /** Number of times each child's `start()` was invoked (initial + restarts). */
  readonly runCounts: ReadonlyMap<string, number>;
  /** Every restart that occurred, in order. */
  readonly restarts: readonly RestartEvent[];
  /** Escalations surfaced (budget exhausted). Empty = clean. */
  readonly escalations: readonly Escalation[];
  /** Last exit reason observed per child (whatever ended its lifecycle). */
  readonly lastExit: ReadonlyMap<string, ExitReason>;
}

/** Normalize any thrown value into an abnormal crash exit. */
function runChildSafely(child: ChildSpec): Promise<ExitReason> {
  return child.start().then(
    (exit) => exit,
    (err: unknown): ExitReason => ({ kind: 'crash', reason: err }),
  );
}

/**
 * Run a supervisor until all children have reached a terminal state (no
 * pending restarts) or an escalation halts a child's restart cycle.
 *
 * This is a "run-to-quiescence" model rather than an infinite daemon loop:
 * children are finite tasks (one ingest pass). A production daemon wraps this
 * in a scheduler (cron / interval); the supervision SEMANTICS — what restarts
 * what, when budgets escalate — are identical and are what we unit-test.
 */
export async function runSupervisor(
  spec: SupervisorSpec,
  clock: Clock = systemClock,
): Promise<SupervisorReport> {
  const runCounts = new Map<string, number>();
  const lastExit = new Map<string, ExitReason>();
  const restarts: RestartEvent[] = [];
  const escalations: Escalation[] = [];
  const byId = new Map<string, ChildSpec>(spec.children.map((c) => [c.id, c]));

  // Children whose restart cycle has been halted by an escalation. They are
  // never restarted again for the life of this supervisor run.
  const halted = new Set<string>();

  // Children whose initial boot has occurred. Under rest_for_one, a crash can
  // pull a not-yet-booted later child into a cascade restart; we mark it booted
  // so the sequential boot loop does not run its initial pass a second time.
  const booted = new Set<string>();

  function bump(id: string): void {
    runCounts.set(id, (runCounts.get(id) ?? 0) + 1);
  }

  /** Run one child once; record its exit; return it. */
  async function runOnce(child: ChildSpec): Promise<ExitReason> {
    booted.add(child.id);
    bump(child.id);
    const exit = await runChildSafely(child);
    lastExit.set(child.id, exit);
    return exit;
  }

  /**
   * Handle a child's termination: apply the pure decision, performing restarts
   * (which may themselves terminate and recurse) until the affected children
   * settle. Returns when no further restart is pending from THIS termination.
   */
  async function handleTermination(child: ChildSpec, exit: ExitReason): Promise<void> {
    const decision: SupervisionDecision = decide(spec, restarts, child.id, exit, clock.now());

    switch (decision.kind) {
      case 'none':
        return;

      case 'escalate': {
        halted.add(decision.childId);
        escalations.push({
          supervisorId: spec.id,
          childId: decision.childId,
          reason: decision.reason,
          atMs: clock.now(),
        });
        return;
      }

      case 'restart': {
        // Restart the affected ordered set sequentially (rest_for_one order).
        for (const id of decision.childIds) {
          /* v8 ignore next -- defensive: an escalated child is not re-issued in a
             fresh restart decision; this prevents restarting a halted child. */
          if (halted.has(id)) continue;
          const target = byId.get(id);
          /* v8 ignore next -- defensive: id always resolves (from spec.children). */
          if (target === undefined) continue;
          restarts.push({ childId: id, atMs: clock.now(), reason: exit });
          const reExit = await runOnce(target);
          // A restarted child that terminates again triggers its own decision.
          await handleTermination(target, reExit);
        }
        return;
      }
    }
  }

  // Initial start order depends on strategy:
  //
  //  - one_for_one  → children are INDEPENDENT, so they boot CONCURRENTLY. An
  //    independent child's crash + restart must not block or affect its
  //    siblings' initial run (isolation). This is the ingest_supervisor case:
  //    8 workers ingest in parallel; one crashing does not touch the others.
  //
  //  - rest_for_one → children form an ORDERED PIPELINE (ingest → renderer →
  //    publisher), so they boot SEQUENTIALLY in start order. A crash mid-boot
  //    cascades to restart the failed child + every later child, in order,
  //    before the next sibling even starts. Sequential boot also means a
  //    restarted downstream child is never racing its own initial run.
  if (spec.strategy === 'one_for_one') {
    await Promise.all(
      spec.children.map(async (child) => {
        const exit = await runOnce(child);
        await handleTermination(child, exit);
      }),
    );
  } else {
    for (const child of spec.children) {
      // Skip a child already booted by a prior cascade restart, or one halted
      // by an escalation.
      if (booted.has(child.id) || halted.has(child.id)) continue;
      const exit = await runOnce(child);
      await handleTermination(child, exit);
    }
  }

  return {
    supervisorId: spec.id,
    runCounts,
    restarts,
    escalations,
    lastExit,
  };
}
