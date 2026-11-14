import { DEFAULT_INGEST_BUDGET } from '../ingest/tree.js';
import { type SupervisorReport } from '../supervision/index.js';
import { type SupervisionPressure } from './use-model.js';

/** Report only observed supervisor events for this invocation, not prior cron runs. */
export function restartPressure(
  report: SupervisorReport | undefined,
  repoCount: number,
): SupervisionPressure {
  return {
    measured: report !== undefined,
    restartCount: report?.restarts.length ?? 0,
    restartBudget: DEFAULT_INGEST_BUDGET.maxRestarts * repoCount,
    escalatedChildIds: report?.escalations.map((event) => event.childId) ?? [],
  };
}
