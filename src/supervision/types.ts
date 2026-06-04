/**
 * Armstrong-style (Erlang/OTP) supervision-tree types.
 *
 * DR-035 § 4.B + amber-lighthouse Epic 2.2. These are pure data + decision
 * types — no I/O. The runtime that drives them lives in `supervisor.ts`.
 *
 * The semantics intentionally mirror OTP:
 *   - restart strategy    one_for_one | rest_for_one
 *   - restart type        permanent | transient | temporary
 *   - intensity/period    max_restarts within a sliding time window → escalate
 *
 * "Escalate" here means the supervisor surfaces an `escalation` (it gives up on
 * that child rather than restarting in an infinite loop), exactly as an OTP
 * supervisor would exit and notify its own parent.
 */

/**
 * How a supervisor reacts when one of its children terminates abnormally.
 *
 * - `one_for_one`  — restart ONLY the child that terminated.
 * - `rest_for_one` — restart the terminated child AND every child that was
 *                    started AFTER it (in start order), preserving order.
 */
export type RestartStrategy = 'one_for_one' | 'rest_for_one';

/**
 * When a child should be restarted.
 *
 * - `permanent` — always restart (on normal OR abnormal exit).
 * - `transient` — restart ONLY on abnormal exit (crash). A normal completion
 *                 is left terminated.
 * - `temporary` — never restart, regardless of exit reason.
 */
export type RestartType = 'permanent' | 'transient' | 'temporary';

/** Why a child process terminated. */
export type ExitReason =
  | { readonly kind: 'normal' }
  | { readonly kind: 'crash'; readonly reason: unknown };

/**
 * A running child's start function. Resolves with how it exited.
 *
 * Implementations MUST NOT throw — a thrown error is normalized to an abnormal
 * `{ kind: 'crash' }` exit by the runtime, but returning the reason explicitly
 * keeps the structured crash detail (e.g., the 8-step ingest reason object)
 * intact for the supervisor's records.
 */
export type ChildStart = () => Promise<ExitReason>;

/** Specification for one supervised child. */
export interface ChildSpec {
  /** Stable identifier, unique within a supervisor (e.g. `ingest_worker:iec`). */
  readonly id: string;
  /** Restart policy for this child. */
  readonly restart: RestartType;
  /** The work the child performs; resolves with its exit reason. */
  readonly start: ChildStart;
}

/**
 * Max-restart budget. If a child is restarted more than `maxRestarts` times
 * within `periodMs`, the supervisor escalates instead of restarting again.
 *
 * OTP's `intensity` / `period`.
 */
export interface RestartBudget {
  readonly maxRestarts: number;
  readonly periodMs: number;
}

/** Static configuration of a supervisor node. */
export interface SupervisorSpec {
  readonly id: string;
  readonly strategy: RestartStrategy;
  readonly budget: RestartBudget;
  /** Children in START ORDER. Order is load-bearing for rest_for_one. */
  readonly children: readonly ChildSpec[];
}

/** A single recorded restart event (timestamp in ms epoch). */
export interface RestartEvent {
  readonly childId: string;
  readonly atMs: number;
  readonly reason: ExitReason;
}

/**
 * The pure decision a supervisor makes when a child terminates.
 *
 * - `none`     — nothing to restart (e.g. transient child exited normally).
 * - `restart`  — restart this ordered set of child ids (in the given order).
 * - `escalate` — the offending child blew its restart budget; the supervisor
 *                gives up and surfaces this to its own parent.
 */
export type SupervisionDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'restart'; readonly childIds: readonly string[] }
  | { readonly kind: 'escalate'; readonly childId: string; readonly reason: ExitReason };
