/**
 * Verdict-derivation tests.
 *
 * The verdict is the "what does this mean" layer. The load-bearing properties:
 * a pass never carries a fix list; an error is treated as loudly as a fail and
 * NEVER as a pass; the what-to-fix list comes verbatim from gate_reasons; and a
 * malformed decision fails closed to error.
 */

import { describe, expect, it } from 'vitest';
import { deriveVerdict, VERDICT_WEIGHT, type VerdictKind } from './verdict.js';
import { testingRow } from './__fixtures__/testing-fixtures.js';

describe('deriveVerdict — pass', () => {
  it('maps pass → good with no fixes', () => {
    const v = deriveVerdict(testingRow({ decision: 'pass' }));
    expect(v.kind).toBe('good');
    expect(v.label).toBe('good');
    expect(v.whatToFix).toEqual([]);
    expect(v.headline).toMatch(/passing/i);
  });
});

describe('deriveVerdict — advisory', () => {
  it('maps advisory → watch, severity in headline, reasons as the watch list', () => {
    const v = deriveVerdict(
      testingRow({ decision: 'advisory', advisorySeverity: 'warn', gateReasons: ['rising CRAP'] }),
    );
    expect(v.kind).toBe('watch');
    expect(v.headline).toContain('(warn)');
    expect(v.whatToFix).toEqual(['rising CRAP']);
  });

  it('falls back when an advisory records no reason', () => {
    const v = deriveVerdict(testingRow({ decision: 'advisory', gateReasons: [] }));
    expect(v.kind).toBe('watch');
    expect(v.headline).not.toContain('(');
    expect(v.whatToFix[0]).toMatch(/no reason/i);
  });
});

describe('deriveVerdict — fail', () => {
  it('maps fail → fail, failure_mode in headline, reasons as the fix list', () => {
    const v = deriveVerdict(
      testingRow({
        decision: 'fail',
        failureMode: 'MM-3',
        gateReasons: ['src/foo.ts below floor', 'src/bar.ts uncovered'],
      }),
    );
    expect(v.kind).toBe('fail');
    expect(v.headline).toContain('[failure mode: MM-3]');
    expect(v.whatToFix).toEqual(['src/foo.ts below floor', 'src/bar.ts uncovered']);
  });

  it('falls back when a fail records no reason', () => {
    const v = deriveVerdict(testingRow({ decision: 'fail', gateReasons: [] }));
    expect(v.whatToFix[0]).toMatch(/no reason/i);
  });
});

describe('deriveVerdict — error is never a pass', () => {
  it('maps error → error with the error class as the fix', () => {
    const v = deriveVerdict(testingRow({ decision: 'error', gateReasons: ['TIMEOUT'] }));
    expect(v.kind).toBe('error');
    expect(v.headline).toMatch(/not a pass/i);
    expect(v.whatToFix).toEqual(['TIMEOUT']);
  });

  it('falls back when an error records no class', () => {
    const v = deriveVerdict(testingRow({ decision: 'error', gateReasons: [] }));
    expect(v.whatToFix[0]).toMatch(/no error class/i);
  });
});

describe('deriveVerdict — robustness', () => {
  it('fails closed to error on an unrecognised decision (never good)', () => {
    // Force an out-of-enum value through the type system to exercise the default.
    const row = testingRow({});
    const bad = { ...row, decision: 'maybe' as unknown as typeof row.decision };
    const v = deriveVerdict(bad);
    expect(v.kind).toBe('error');
    expect(v.headline).toMatch(/never as a pass/i);
  });

  it('filters whitespace-only reasons out of the fix list', () => {
    const v = deriveVerdict(
      testingRow({ decision: 'fail', gateReasons: ['  ', 'real reason', ''] }),
    );
    expect(v.whatToFix).toEqual(['real reason']);
  });
});

describe('VERDICT_WEIGHT ordering', () => {
  it('orders fail < error < watch < good (loudest first)', () => {
    const order: VerdictKind[] = ['fail', 'error', 'watch', 'good'];
    for (let i = 1; i < order.length; i++) {
      expect(VERDICT_WEIGHT[order[i - 1]!]).toBeLessThan(VERDICT_WEIGHT[order[i]!]);
    }
  });
});
