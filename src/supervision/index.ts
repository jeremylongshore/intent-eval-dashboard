/**
 * Supervision-tree public surface (Armstrong / OTP semantics).
 *
 * DR-035 § 4.B + amber-lighthouse Epic 2.2.
 */

export type {
  ChildSpec,
  ChildStart,
  ExitReason,
  RestartBudget,
  RestartEvent,
  RestartStrategy,
  RestartType,
  SupervisionDecision,
  SupervisorSpec,
} from './types.js';

export { affectedChildIds, budgetExceeded, decide, shouldRestart } from './strategy.js';

export {
  type Clock,
  type Escalation,
  type SupervisorReport,
  runSupervisor,
  systemClock,
} from './supervisor.js';
