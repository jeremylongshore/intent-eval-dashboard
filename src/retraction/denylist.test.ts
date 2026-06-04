/**
 * Retraction denylist validator tests (bead puxu.10).
 *
 * The load-bearing GC binding: an OUT-OF-SET `reason_class` (open text) MUST be
 * rejected. Plus the at-least-one-subject rule, the safe-deep-URL rule, and
 * strict unknown-field rejection.
 */

import { describe, expect, it } from 'vitest';
import { validateDenylist, RetractionEntrySchema, type RetractionEntry } from './denylist.js';

/** A minimal valid entry used as the mutation base. */
const VALID: RetractionEntry = {
  bundle_id: '0190b8e5-7c1a-7000-8000-000000000000',
  deep_url_path: '/results/iec/0190b8e5/',
  reason_class: 'partner-request',
  retracted_at: '2026-06-04T12:00:00Z',
};

describe('validateDenylist — closed-set reason_class (GC binding)', () => {
  it('REJECTS an out-of-set reason_class ("because-i-said-so")', () => {
    const result = validateDenylist([{ ...VALID, reason_class: 'because-i-said-so' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const onReason = result.issues.find((i) => i.path === 'reason_class' || i.index === 0);
      expect(onReason).toBeDefined();
    }
  });

  it('REJECTS empty-string + arbitrary free-text reason_class', () => {
    for (const bad of ['', 'urgent', 'we changed our minds', 'PARTNER-REQUEST']) {
      const result = validateDenylist([{ ...VALID, reason_class: bad }]);
      expect(result.ok).toBe(false);
    }
  });

  it('ACCEPTS every member of the closed set', () => {
    const set = [
      'partner-request',
      'methodology-error',
      'data-quality',
      'consent-withdrawn',
      'legal-hold',
      'pre-publication-recall',
    ] as const;
    for (const reason_class of set) {
      const result = validateDenylist([{ ...VALID, reason_class }]);
      expect(result.ok, `reason_class ${reason_class} should be accepted`).toBe(true);
    }
  });
});

describe('validateDenylist — subject + structure', () => {
  it('REJECTS an entry with NO signed-subject reference', () => {
    const noSubject = {
      deep_url_path: '/results/iec/x/',
      reason_class: 'partner-request',
      retracted_at: '2026-06-04T12:00:00Z',
    };
    const result = validateDenylist([noSubject]);
    expect(result.ok).toBe(false);
  });

  it('ACCEPTS an entry keyed only by storage_key', () => {
    const result = validateDenylist([
      {
        storage_key: 'sha256/ab/cd/abcd',
        deep_url_path: '/results/iec/x/',
        reason_class: 'data-quality',
        retracted_at: '2026-06-04T12:00:00Z',
      },
    ]);
    expect(result.ok).toBe(true);
  });

  it('REJECTS an unsafe deep_url_path (traversal / not absolute / query)', () => {
    for (const bad of ['../etc/passwd', 'results/iec/x', '/results/iec/x?evil=1', '/a b/']) {
      const result = validateDenylist([{ ...VALID, deep_url_path: bad }]);
      expect(result.ok, `deep_url_path ${bad} should be rejected`).toBe(false);
    }
  });

  it('REJECTS an unknown / extra field (strict)', () => {
    const result = validateDenylist([{ ...VALID, reasonClass: 'partner-request' }]);
    expect(result.ok).toBe(false);
  });

  it('REJECTS a non-array top-level value', () => {
    const result = validateDenylist({ not: 'an array' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it('ACCEPTS an empty denylist ([]) as a valid state', () => {
    const result = validateDenylist([]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.denylist).toEqual([]);
  });

  it('carries the optional note + retracted_by through', () => {
    const result = validateDenylist([
      {
        ...VALID,
        note: 'partner X requested removal on 2026-06-03',
        retracted_by: 'ops@intentsolutions.io',
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.denylist[0]?.note).toContain('partner X');
      expect(result.denylist[0]?.retracted_by).toBe('ops@intentsolutions.io');
    }
  });
});

describe('RetractionEntrySchema — direct safeParse', () => {
  it('parses a fully-specified entry', () => {
    const parsed = RetractionEntrySchema.safeParse({
      bundle_id: '0190b8e5-7c1a-7000-8000-000000000000',
      storage_key: 'sha256/ab/cd/abcd',
      content_hash: 'sha256:' + 'a'.repeat(64),
      deep_url_path: '/results/iec/0190b8e5/',
      reason_class: 'legal-hold',
      retracted_at: '2026-06-04T12:00:00Z',
      note: 'court order #1234',
      retracted_by: 'gc@intentsolutions.io',
    });
    expect(parsed.success).toBe(true);
  });
});
