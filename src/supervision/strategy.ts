/**
 * Pure supervision decision logic.
 *
 * Every function here is a pure function of (spec, history, event) → decision.
 * No clocks, no I/O, no mutation of inputs. This is what makes the OTP
 * semantics deterministically unit-testable (the synthetic-attack tests and
 * the semantics tests both drive these directly).
 */

import {
  type ChildSpec,
  type ExitReason,
  type RestartBudget,
  type RestartEvent,
  type SupervisionDecision,
  type SupervisorSpec,
} from './types.js';

/**
 * Does this exit reason warrant a restart for a child with the given restart
 * type? Pure: encodes the permanent/transient/temporary table.
 *
 * - permanent → always
 * - transient → only on abnormal (crash) exit
 * - temporary → never
 */
export function shouldRestart(restart: ChildSpec['restart'], exit: ExitReason): boolean {
  switch (restart) {
    case 'permanent':
      return true;
    case 'transient':
      return exit.kind === 'crash';
    case 'temporary':
      return false;
  }
}

/**
 * The ordered set of child ids a strategy restarts when `failedId` terminates
 * (assuming a restart is warranted). Pure.
 *
 * - one_for_one  → just the failed child.
 * - rest_for_one → the failed child + every child started AFTER it, in order.
 *
 * Throws if `failedId` is not a child of this supervisor (programmer error).
 */
export function affectedChildIds(spec: SupervisorSpec, failedId: string): readonly string[] {
  const index = spec.children.findIndex((c) => c.id === failedId);
  if (index < 0) {
    throw new Error(`affectedChildIds: ${failedId} is not a child of supervisor ${spec.id}`);
  }
  switch (spec.strategy) {
    case 'one_for_one':
      return [failedId];
    case 'rest_for_one':
      return spec.children.slice(index).map((c) => c.id);
  }
}

/**
 * Has the child exceeded its restart budget within the sliding window ending at
 * `nowMs`? Counts prior restart events for `childId` whose timestamp is within
 * `periodMs` of now. Pure.
 *
 * Returns true when adding ONE more restart now would exceed `maxRestarts`
 * within the window — i.e. the budget is already spent.
 */
export function budgetExceeded(
  budget: RestartBudget,
  history: readonly RestartEvent[],
  childId: string,
  nowMs: number,
): boolean {
  const windowStart = nowMs - budget.periodMs;
  const recent = history.filter(
    (e) => e.childId === childId && e.atMs > windowStart && e.atMs <= nowMs,
  );
  // `recent` is the count of restarts already performed in the window. One more
  // restart is allowed only while recent < maxRestarts.
  return recent.length >= budget.maxRestarts;
}

/**
 * The full pure decision for one child termination.
 *
 * Combines shouldRestart + budget + strategy:
 *   1. If no restart warranted (transient-normal / temporary) → `none`.
 *   2. Else if the failed child's budget is spent → `escalate`.
 *   3. Else → `restart` the strategy-affected ordered child set.
 *
 * `history` is the list of PRIOR restart events (not yet including this one).
 */
export function decide(
  spec: SupervisorSpec,
  history: readonly RestartEvent[],
  failedId: string,
  exit: ExitReason,
  nowMs: number,
): SupervisionDecision {
  const child = spec.children.find((c) => c.id === failedId);
  if (child === undefined) {
    throw new Error(`decide: ${failedId} is not a child of supervisor ${spec.id}`);
  }

  if (!shouldRestart(child.restart, exit)) {
    return { kind: 'none' };
  }

  if (budgetExceeded(spec.budget, history, failedId, nowMs)) {
    return { kind: 'escalate', childId: failedId, reason: exit };
  }

  return { kind: 'restart', childIds: affectedChildIds(spec, failedId) };
}
