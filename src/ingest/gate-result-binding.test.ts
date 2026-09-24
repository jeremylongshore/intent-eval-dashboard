import { describe, expect, it } from 'vitest';
import { validEvidenceBundle, validGateResult } from './__fixtures__/bundle-fixtures.js';
import { checkGateResultBinding } from './gate-result-binding.js';

function expectRejected(bundle: unknown, bodies: unknown, detail: RegExp): void {
  const result = checkGateResultBinding(bundle, bodies);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.detail).toMatch(detail);
}

describe('checkGateResultBinding', () => {
  it('accepts a kernel-valid body committed by every signed metadata field', () => {
    const body = validGateResult();
    const result = checkGateResultBinding(validEvidenceBundle(body), [body]);
    expect(result).toEqual({ ok: true, bodies: [body] });
  });

  it('rejects an invalid bundle and a missing body array', () => {
    expectRejected({}, [], /invalid EvidenceBundle/);
    expectRejected(validEvidenceBundle(), undefined, /must be an array/);
  });

  it('rejects unsupported row counts, missing predicate claims, and malformed bodies', () => {
    const body = validGateResult();
    expectRejected({ ...validEvidenceBundle(body), row_count: 2 }, [body], /exactly one/);
    expectRejected(
      { ...validEvidenceBundle(body), predicate_uri_set: ['https://example.invalid/v1'] },
      [body],
      /does not claim/,
    );
    expectRejected(validEvidenceBundle(body), [{}], /not a kernel gate-result/);
  });

  it('rejects body, subject-count, subject-name, and subject-digest tampering', () => {
    const body = validGateResult();
    expectRejected(
      validEvidenceBundle(body),
      [{ ...body, gate_decision: 'fail', gate_reasons: ['tampered'] }],
      /storage_key/,
    );
    expectRejected({ ...validEvidenceBundle(body), subject_set: [] }, [body], /signed subject/);
    expectRejected(
      {
        ...validEvidenceBundle(body),
        subject_set: [{ name: 'j-rig:ci:other-gate', digest: { sha256: 'a'.repeat(64) } }],
      },
      [body],
      /identity\/input digest/,
    );
    expectRejected(
      {
        ...validEvidenceBundle(body),
        subject_set: [{ name: body['gate_id'], digest: { sha256: 'e'.repeat(64) } }],
      },
      [body],
      /identity\/input digest/,
    );
  });
});
