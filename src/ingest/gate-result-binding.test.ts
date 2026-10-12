import { describe, expect, it } from 'vitest';
import {
  validCanonicalBundle,
  validEvidenceBundle,
  validEvidencePayload,
  validGateResult,
} from './__fixtures__/bundle-fixtures.js';
import { checkGateResultBinding } from './gate-result-binding.js';
import { canonicalJsonBytes, sha256Key } from './content-address.js';
import marketplaceFixture from './__fixtures__/marketplace-canonical-payload.json' with { type: 'json' };

describe('marketplace producer interoperability', () => {
  const { bundle, gateResult, evidencePayload } = marketplaceFixture.row;

  it('accepts the producer-generated statement payload and derives its predicate', () => {
    expect(checkGateResultBinding(bundle, undefined, evidencePayload)).toEqual({
      ok: true,
      bodies: [gateResult],
      evidencePayload,
    });
    expect(checkGateResultBinding(bundle, [gateResult], evidencePayload).ok).toBe(true);
  });

  it('rejects a changed predicate even when its redundant projection agrees', () => {
    const body = { ...gateResult, gate_reasons: ['tampered producer verdict'] };
    const payload = [{ ...evidencePayload[0]!, predicate: body }];
    expect(checkGateResultBinding(bundle, [body], payload).ok).toBe(false);
  });

  it('rejects a changed redundant body and a removed canonical payload', () => {
    expect(
      checkGateResultBinding(
        bundle,
        [{ ...gateResult, gate_reasons: ['tampered'] }],
        evidencePayload,
      ).ok,
    ).toBe(false);
    expect(checkGateResultBinding(bundle, [gateResult]).ok).toBe(false);
  });
});

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

describe('canonical EvidenceBundlePayload binding', () => {
  const payload = validEvidencePayload([
    validGateResult(),
    {
      ...validGateResult(),
      gate_id: 'j-rig:ci:second-gate',
      input_hash: `sha256:${'b'.repeat(64)}`,
    },
  ]);

  it('accepts multiple invariant-checked statements and derives their bodies', () => {
    expect(checkGateResultBinding(validCanonicalBundle(payload), undefined, payload)).toEqual({
      ok: true,
      bodies: payload.map((row) => row.predicate),
      evidencePayload: payload,
    });
  });

  it('requires a deduplicated subject set while preserving statement order', () => {
    const repeated = [payload[0]!, payload[0]!];
    const bundle = validCanonicalBundle(repeated);
    expect(bundle['subject_set']).toHaveLength(1);
    expect(checkGateResultBinding(bundle, undefined, repeated).ok).toBe(true);
    expect(
      checkGateResultBinding(validCanonicalBundle(payload), undefined, [...payload].reverse()).ok,
    ).toBe(false);
  });

  it('accepts a kernel-valid empty payload only with matching empty metadata', () => {
    expect(checkGateResultBinding(validCanonicalBundle([]), [], []).ok).toBe(true);
  });

  it.each([
    ['digest', { storage_key: `sha256:${'f'.repeat(64)}` }],
    ['row_count', { row_count: 1 }],
    ['missing subject', { subject_set: [payload[0]!.subject[0]] }],
    ['duplicate subject', { subject_set: [payload[0]!.subject[0], payload[0]!.subject[0]] }],
    ['wrong subject', { subject_set: [{ name: 'wrong', digest: { sha256: 'f'.repeat(64) } }] }],
    ['missing predicate', { predicate_uri_set: [] }],
    [
      'extra predicate',
      { predicate_uri_set: [payload[0]!.predicateType, 'https://example.invalid/v1'] },
    ],
    [
      'duplicate predicate',
      { predicate_uri_set: [payload[0]!.predicateType, payload[0]!.predicateType] },
    ],
  ])('rejects signed metadata with %s mismatch', (_name, overrides) => {
    expect(
      checkGateResultBinding({ ...validCanonicalBundle(payload), ...overrides }, undefined, payload)
        .ok,
    ).toBe(false);
  });

  it('validates statement invariants even when a producer hashes invalid statements', () => {
    const invalid = [
      { ...payload[0]!, subject: [{ name: 'wrong', digest: { sha256: 'a'.repeat(64) } }] },
    ];
    const bundle = {
      ...validCanonicalBundle(payload),
      storage_key: sha256Key(canonicalJsonBytes(invalid)),
    };
    const result = checkGateResultBinding(bundle, undefined, invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/kernel EvidenceBundlePayload/);
  });

  it('binds extensions as well as predicate bodies', () => {
    const tampered = [{ ...payload[0]!, extensions: { injected: true } }, payload[1]!];
    expect(checkGateResultBinding(validCanonicalBundle(payload), undefined, tampered).ok).toBe(
      false,
    );
  });

  it('rejects a contradictory redundant body projection', () => {
    const bundle = validCanonicalBundle(payload);
    const bodies = payload.map((row) => row.predicate);
    expect(checkGateResultBinding(bundle, bodies, payload).ok).toBe(true);
    expect(
      checkGateResultBinding(bundle, [{ ...bodies[0]!, gate_decision: 'fail' }], payload).ok,
    ).toBe(false);
  });

  it.each([null, {}, 'invalid', []])(
    'never falls back to a valid legacy body for payload %j',
    (invalid) => {
      const body = validGateResult();
      expect(checkGateResultBinding(validEvidenceBundle(body), [body], invalid).ok).toBe(false);
    },
  );
});
