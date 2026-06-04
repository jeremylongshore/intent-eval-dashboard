/**
 * Pure supervision-decision tests — the OTP semantics.
 *
 * one_for_one isolation · rest_for_one cascade · transient vs permanent ·
 * max_restarts window escalation.
 */

import { describe, expect, it } from 'vitest';
import {
  affectedChildIds,
  budgetExceeded,
  decide,
  shouldRestart,
} from './strategy.js';
import {
  type ExitReason,
  type RestartBudget,
  type RestartEvent,
  type SupervisorSpec,
} from './types.js';

const crash: ExitReason = { kind: 'crash', reason: new Error('boom') };
const normal: ExitReason = { kind: 'normal' };

function spec(strategy: SupervisorSpec['strategy'], ids: string[]): SupervisorSpec {
  return {
    id: 'sup',
    strategy,
    budget: { maxRestarts: 100, periodMs: 1000 },
    children: ids.map((id) => ({
      id,
      restart: 'transient' as const,
      start: () => Promise.resolve(normal),
    })),
  };
}

describe('shouldRestart — restart types', () => {
  it('permanent restarts on normal AND crash', () => {
    expect(shouldRestart('permanent', normal)).toBe(true);
    expect(shouldRestart('permanent', crash)).toBe(true);
  });

  it('transient restarts ONLY on crash, not normal completion', () => {
    expect(shouldRestart('transient', crash)).toBe(true);
    expect(shouldRestart('transient', normal)).toBe(false);
  });

  it('temporary never restarts', () => {
    expect(shouldRestart('temporary', crash)).toBe(false);
    expect(shouldRestart('temporary', normal)).toBe(false);
  });
});

describe('affectedChildIds — strategy semantics', () => {
  it('one_for_one restarts ONLY the failed child', () => {
    const s = spec('one_for_one', ['a', 'b', 'c']);
    expect(affectedChildIds(s, 'b')).toEqual(['b']);
    expect(affectedChildIds(s, 'a')).toEqual(['a']);
    expect(affectedChildIds(s, 'c')).toEqual(['c']);
  });

  it('rest_for_one restarts the failed child + every child started after it (in order)', () => {
    const s = spec('rest_for_one', ['ingest', 'renderer', 'publisher']);
    // renderer fails → renderer + publisher
    expect(affectedChildIds(s, 'renderer')).toEqual(['renderer', 'publisher']);
    // publisher fails → only publisher
    expect(affectedChildIds(s, 'publisher')).toEqual(['publisher']);
    // ingest fails → all three
    expect(affectedChildIds(s, 'ingest')).toEqual(['ingest', 'renderer', 'publisher']);
  });

  it('throws for an unknown child', () => {
    const s = spec('one_for_one', ['a']);
    expect(() => affectedChildIds(s, 'nope')).toThrow(/not a child/);
  });
});

describe('budgetExceeded — max_restarts window', () => {
  const budget: RestartBudget = { maxRestarts: 3, periodMs: 1000 };

  it('is false until the budget is spent within the window', () => {
    const history: RestartEvent[] = [
      { childId: 'w', atMs: 100, reason: crash },
      { childId: 'w', atMs: 200, reason: crash },
    ];
    // 2 prior restarts in window, max 3 → one more allowed
    expect(budgetExceeded(budget, history, 'w', 300)).toBe(false);
  });

  it('is true once maxRestarts are already in the window', () => {
    const history: RestartEvent[] = [
      { childId: 'w', atMs: 100, reason: crash },
      { childId: 'w', atMs: 200, reason: crash },
      { childId: 'w', atMs: 300, reason: crash },
    ];
    expect(budgetExceeded(budget, history, 'w', 400)).toBe(true);
  });

  it('ignores restarts outside the sliding window', () => {
    const history: RestartEvent[] = [
      { childId: 'w', atMs: 0, reason: crash }, // 1500ms ago — outside 1000ms window
      { childId: 'w', atMs: 600, reason: crash },
    ];
    expect(budgetExceeded(budget, history, 'w', 1500)).toBe(false);
  });

  it('counts per-child (a sibling burning its budget does not affect us)', () => {
    const history: RestartEvent[] = [
      { childId: 'other', atMs: 100, reason: crash },
      { childId: 'other', atMs: 150, reason: crash },
      { childId: 'other', atMs: 200, reason: crash },
    ];
    expect(budgetExceeded(budget, history, 'w', 250)).toBe(false);
  });
});

describe('decide — combined decision', () => {
  it('returns none for a transient child that exited normally', () => {
    const s = spec('one_for_one', ['a']);
    expect(decide(s, [], 'a', normal, 0)).toEqual({ kind: 'none' });
  });

  it('returns restart with one_for_one set on a transient crash', () => {
    const s = spec('one_for_one', ['a', 'b']);
    expect(decide(s, [], 'a', crash, 0)).toEqual({ kind: 'restart', childIds: ['a'] });
  });

  it('returns restart with rest_for_one cascade set', () => {
    const s = spec('rest_for_one', ['a', 'b', 'c']);
    expect(decide(s, [], 'b', crash, 0)).toEqual({ kind: 'restart', childIds: ['b', 'c'] });
  });

  it('escalates when the budget is exhausted instead of looping forever', () => {
    const s: SupervisorSpec = {
      ...spec('one_for_one', ['a']),
      budget: { maxRestarts: 2, periodMs: 1000 },
    };
    const history: RestartEvent[] = [
      { childId: 'a', atMs: 1, reason: crash },
      { childId: 'a', atMs: 2, reason: crash },
    ];
    expect(decide(s, history, 'a', crash, 3)).toEqual({
      kind: 'escalate',
      childId: 'a',
      reason: crash,
    });
  });

  it('throws for an unknown child', () => {
    const s = spec('one_for_one', ['a']);
    expect(() => decide(s, [], 'nope', crash, 0)).toThrow(/not a child/);
  });
});
