/**
 * retraction/v1 Statement emission tests (bead puxu.10).
 *
 * Load-bearing assertions:
 *   - a valid denylist entry produces a retraction/v1 Statement whose predicate
 *     body PASSES the KERNEL's RetractionV1Schema (single source of truth).
 *   - the predicate URI host is `evals.intentsolutions.io`, NEVER `labs.*`
 *     (CISO binding).
 *   - the default signer never fakes a signature (signed: false + canonical
 *     payload, no fabricated Rekor index / DSSE envelope).
 */

import { describe, expect, it } from 'vitest';
import { RetractionV1Schema } from '@intentsolutions/core/validators/v1/retraction-v1';
import { type RetractionEntry } from './denylist.js';
import {
  buildRetractionPredicate,
  buildRetractionStatement,
  canonicalizeStatement,
  RETRACTION_V1_URI,
  signRetraction,
} from './statement.js';

const ENTRY: RetractionEntry = {
  bundle_id: '0190b8e5-7c1a-7000-8000-000000000000',
  deep_url_path: '/results/iec/0190b8e5/',
  reason_class: 'partner-request',
  retracted_at: '2026-06-04T12:00:00Z',
  note: 'partner requested removal',
  retracted_by: 'ops@intentsolutions.io',
};

describe('predicate URI (CISO binding)', () => {
  it('is hosted at evals.intentsolutions.io', () => {
    expect(RETRACTION_V1_URI).toBe('https://evals.intentsolutions.io/retraction/v1');
    expect(new URL(RETRACTION_V1_URI).host).toBe('evals.intentsolutions.io');
  });

  it('is NEVER hosted at labs.*', () => {
    expect(RETRACTION_V1_URI).not.toContain('labs.');
    expect(new URL(RETRACTION_V1_URI).host).not.toBe('labs.intentsolutions.io');
  });

  it('the built Statement declares predicateType at evals.*, not labs.*', () => {
    const stmt = buildRetractionStatement(ENTRY);
    expect(stmt.predicateType).toBe(RETRACTION_V1_URI);
    expect(stmt.predicateType).toContain('evals.intentsolutions.io');
    expect(stmt.predicateType).not.toContain('labs.');
  });
});

describe('buildRetractionPredicate — kernel validation', () => {
  it('produces a body that PASSES the kernel RetractionV1Schema', () => {
    const body = buildRetractionPredicate(ENTRY);
    const parsed = RetractionV1Schema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('maps the internal note to the optional predicate `reason` field', () => {
    const body = buildRetractionPredicate(ENTRY);
    expect(body.reason).toBe('partner requested removal');
    expect(body.retracted_by).toBe('ops@intentsolutions.io');
  });

  it('carries retracted_subject through (bundle_id)', () => {
    const body = buildRetractionPredicate(ENTRY);
    expect(body.retracted_subject.bundle_id).toBe(ENTRY.bundle_id);
  });

  it('does NOT carry deep_url_path into the predicate body (rendering-only)', () => {
    const body = buildRetractionPredicate(ENTRY);
    expect(JSON.stringify(body)).not.toContain('deep_url_path');
  });

  it('surfaces the bare hex sha256 digest from a sha256:-prefixed content_hash', () => {
    const entry: RetractionEntry = {
      content_hash: 'sha256:' + 'c'.repeat(64),
      deep_url_path: '/results/iar/x/',
      reason_class: 'data-quality',
      retracted_at: '2026-06-04T12:00:00Z',
    };
    const stmt = buildRetractionStatement(entry);
    expect(stmt.subject[0]?.digest.sha256).toBe('c'.repeat(64));
    expect(stmt.subject[0]?.name).toBe(entry.content_hash);
  });

  it('throws (defence in depth) if a constructed body fails kernel validation', () => {
    // Force an invalid body past the denylist by hand-constructing an entry with
    // a content_hash that is not sha256:-prefixed (the kernel Sha256Prefixed
    // brand rejects it). The denylist `z.string().min(1)` accepts it, so this is
    // exactly the defence-in-depth path: the kernel is the final gate.
    const entry: RetractionEntry = {
      content_hash: 'not-a-sha256-prefixed-digest',
      deep_url_path: '/results/iaj/x/',
      reason_class: 'data-quality',
      retracted_at: '2026-06-04T12:00:00Z',
    };
    expect(() => buildRetractionPredicate(entry)).toThrow(/failed kernel validation/);
  });

  it('omits optional fields when absent (exactOptionalPropertyTypes)', () => {
    const minimal: RetractionEntry = {
      storage_key: 'sha256/ab/cd/abcd',
      deep_url_path: '/results/iah/x/',
      reason_class: 'data-quality',
      retracted_at: '2026-06-04T12:00:00Z',
    };
    const body = buildRetractionPredicate(minimal);
    expect(RetractionV1Schema.safeParse(body).success).toBe(true);
    expect('reason' in body).toBe(false);
    expect('retracted_by' in body).toBe(false);
  });
});

describe('full Statement', () => {
  it('is a valid in-toto Statement v1 envelope', () => {
    const stmt = buildRetractionStatement(ENTRY);
    expect(stmt._type).toBe('https://in-toto.io/Statement/v1');
    expect(stmt.subject.length).toBe(1);
    expect(stmt.subject[0]?.name).toBe(ENTRY.bundle_id);
  });

  it('canonicalizes deterministically (stable key order)', () => {
    const a = canonicalizeStatement(buildRetractionStatement(ENTRY));
    const b = canonicalizeStatement(buildRetractionStatement(ENTRY));
    expect(a).toBe(b);
    // Keys are sorted: `_type` < `predicate` < `predicateType` < `subject`.
    expect(a.indexOf('"_type"')).toBeLessThan(a.indexOf('"predicate"'));
  });
});

describe('signing seam — no faked signatures', () => {
  it('default signer returns signed:false with a canonical payload, never a fake sig', async () => {
    const result = await signRetraction(ENTRY);
    expect(result.signed).toBe(false);
    if (!result.signed) {
      expect(result.reason).toBe('no-signer-wired');
      expect(result.canonicalPayload).toContain(RETRACTION_V1_URI);
      // No fabricated Rekor index / DSSE envelope on the unsigned path.
      expect(result).not.toHaveProperty('rekorLogIndex');
      expect(result).not.toHaveProperty('dsseEnvelope');
    }
  });

  it('honours an injected (real) signer', async () => {
    const result = await signRetraction(ENTRY, {
      sign: (statement) =>
        Promise.resolve({
          signed: true,
          statement,
          dsseEnvelope: 'base64-dsse',
          rekorLogIndex: 42,
        }),
    });
    expect(result.signed).toBe(true);
    if (result.signed) {
      expect(result.rekorLogIndex).toBe(42);
      expect(result.statement.predicateType).toBe(RETRACTION_V1_URI);
    }
  });
});
