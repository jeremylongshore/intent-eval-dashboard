/**
 * Supervisor RUNTIME tests — the decisions in strategy.ts, driven for real.
 *
 * Proves: one_for_one isolation, rest_for_one cascade, transient vs permanent
 * restart, max_restarts escalation (no infinite loop), and crash normalization.
 */

import { describe, expect, it } from 'vitest';
import { runSupervisor, type Clock } from './supervisor.js';
import { type ChildSpec, type ExitReason, type SupervisorSpec } from './types.js';

/** A clock that advances 1ms per call so each restart gets a distinct stamp. */
function tickingClock(): Clock {
  let t = 0;
  return { now: () => ++t };
}

/**
 * A child that crashes its first `crashes` runs, then exits normally. Counts
 * invocations so a test can assert exactly how many times it ran.
 */
function flakyChild(id: string, crashes: number, counter: { n: number }): ChildSpec {
  let remaining = crashes;
  return {
    id,
    restart: 'transient',
    start: async (): Promise<ExitReason> => {
      counter.n += 1;
      if (remaining > 0) {
        remaining -= 1;
        return { kind: 'crash', reason: new Error(`${id} crash`) };
      }
      return { kind: 'normal' };
    },
  };
}

describe('runSupervisor — one_for_one isolation', () => {
  it('a crashing transient child restarts ONLY itself; siblings run exactly once', async () => {
    const aRuns = { n: 0 };
    const bRuns = { n: 0 };
    const cRuns = { n: 0 };
    const spec: SupervisorSpec = {
      id: 'ingest_supervisor',
      strategy: 'one_for_one',
      budget: { maxRestarts: 5, periodMs: 10_000 },
      children: [
        flakyChild('a', 0, aRuns),
        flakyChild('b', 2, bRuns), // crashes twice then succeeds
        flakyChild('c', 0, cRuns),
      ],
    };
    const report = await runSupervisor(spec, tickingClock());

    // b ran 3 times (initial + 2 restarts); a and c ran exactly once (isolated).
    expect(bRuns.n).toBe(3);
    expect(aRuns.n).toBe(1);
    expect(cRuns.n).toBe(1);
    expect(report.runCounts.get('a')).toBe(1);
    expect(report.runCounts.get('b')).toBe(3);
    expect(report.runCounts.get('c')).toBe(1);
    expect(report.escalations).toHaveLength(0);
    // Only b appears in the restart log.
    expect(report.restarts.every((r) => r.childId === 'b')).toBe(true);
    expect(report.restarts).toHaveLength(2);
  });
});

describe('runSupervisor — transient vs permanent', () => {
  it('transient child that exits normally is NOT restarted', async () => {
    const runs = { n: 0 };
    const spec: SupervisorSpec = {
      id: 'sup',
      strategy: 'one_for_one',
      budget: { maxRestarts: 5, periodMs: 10_000 },
      children: [flakyChild('t', 0, runs)],
    };
    const report = await runSupervisor(spec, tickingClock());
    expect(runs.n).toBe(1);
    expect(report.restarts).toHaveLength(0);
  });

  it('permanent child IS restarted on normal completion (up to its budget)', async () => {
    let runs = 0;
    const spec: SupervisorSpec = {
      id: 'sup',
      strategy: 'one_for_one',
      budget: { maxRestarts: 3, periodMs: 10_000 },
      children: [
        {
          id: 'p',
          restart: 'permanent',
          start: async (): Promise<ExitReason> => {
            runs += 1;
            return { kind: 'normal' }; // always "completes" → permanent restarts it
          },
        },
      ],
    };
    const report = await runSupervisor(spec, tickingClock());
    // initial run + 3 budgeted restarts = 4 runs, then escalate (budget spent).
    expect(runs).toBe(4);
    expect(report.escalations).toHaveLength(1);
    expect(report.escalations[0]?.childId).toBe('p');
  });
});

describe('runSupervisor — max_restarts escalation', () => {
  it('a child that always crashes escalates instead of looping forever', async () => {
    let runs = 0;
    const spec: SupervisorSpec = {
      id: 'sup',
      strategy: 'one_for_one',
      budget: { maxRestarts: 3, periodMs: 10_000 },
      children: [
        {
          id: 'doomed',
          restart: 'transient',
          start: async (): Promise<ExitReason> => {
            runs += 1;
            return { kind: 'crash', reason: new Error('always') };
          },
        },
      ],
    };
    const report = await runSupervisor(spec, tickingClock());
    // initial + 3 restarts = 4 runs, then escalate (not infinite).
    expect(runs).toBe(4);
    expect(report.escalations).toHaveLength(1);
    expect(report.escalations[0]?.childId).toBe('doomed');
  });
});

describe('runSupervisor — rest_for_one cascade', () => {
  it('a failing middle child restarts it + all later children, not earlier ones', async () => {
    // Finite one-shot pass nodes use `transient` (the realistic deploy-tree
    // config — a node that completes its pass normally is not restarted; only
    // an abnormal crash triggers supervision + the rest_for_one cascade).
    const order: string[] = [];
    let rendererCrashed = false;
    const spec: SupervisorSpec = {
      id: 'deploy_supervisor',
      strategy: 'rest_for_one',
      budget: { maxRestarts: 5, periodMs: 10_000 },
      children: [
        {
          id: 'ingest',
          restart: 'transient',
          start: async (): Promise<ExitReason> => {
            order.push('ingest');
            return { kind: 'normal' };
          },
        },
        {
          id: 'renderer',
          restart: 'transient',
          start: async (): Promise<ExitReason> => {
            order.push('renderer');
            if (!rendererCrashed) {
              rendererCrashed = true;
              return { kind: 'crash', reason: new Error('renderer boom') };
            }
            return { kind: 'normal' };
          },
        },
        {
          id: 'publisher',
          restart: 'transient',
          start: async (): Promise<ExitReason> => {
            order.push('publisher');
            return { kind: 'normal' };
          },
        },
      ],
    };
    const report = await runSupervisor(spec, tickingClock());

    // ingest ran once (earlier than renderer → not restarted by rest_for_one).
    expect(report.runCounts.get('ingest')).toBe(1);
    // renderer ran twice (initial crash + 1 restart).
    expect(report.runCounts.get('renderer')).toBe(2);
    // publisher ran ONCE — but as part of the renderer cascade (rest_for_one
    // restarts renderer + publisher), not its own initial boot. The sequential
    // boot loop then skips it (already booted by the cascade). Net: exactly one
    // publisher run, and it happened AFTER the renderer restart.
    expect(report.runCounts.get('publisher')).toBe(1);
    expect(order).toEqual(['ingest', 'renderer', 'renderer', 'publisher']);
    expect(report.escalations).toHaveLength(0);
  });
});

describe('runSupervisor — crash normalization', () => {
  it('a child that THROWS is treated as an abnormal crash exit', async () => {
    let runs = 0;
    const spec: SupervisorSpec = {
      id: 'sup',
      strategy: 'one_for_one',
      budget: { maxRestarts: 1, periodMs: 10_000 },
      children: [
        {
          id: 'thrower',
          restart: 'transient',
          start: async (): Promise<ExitReason> => {
            runs += 1;
            throw new Error('uncaught');
          },
        },
      ],
    };
    const report = await runSupervisor(spec, tickingClock());
    // thrown → crash → transient restart once → budget(1) spent → escalate.
    expect(runs).toBe(2);
    expect(report.escalations).toHaveLength(1);
    const lastExit = report.lastExit.get('thrower');
    expect(lastExit?.kind).toBe('crash');
  });
});
