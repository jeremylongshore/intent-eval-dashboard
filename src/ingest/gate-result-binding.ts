/**
 * Verify that the gate-result body adjacent to a signed EvidenceBundle is the
 * exact body the signed bundle commits to.
 *
 * The signed metadata content-addresses an adjacent `evidencePayload`: the
 * kernel's ordered array of invariant-checked in-toto statements. Legacy
 * producers may still supply exactly one `gateResults` body committed by its
 * own digest. A supplied canonical payload must validate; it never falls back
 * to legacy binding. Both ingest and render-time readers use this boundary.
 */

import {
  GateResultV1Schema,
  GATE_RESULT_V1_URI,
  type GateResultV1,
} from '@intentsolutions/core/validators/v1/gate-result-v1';
import { EvidenceBundleSchema } from '@intentsolutions/core/validators/v1/evidence-bundle';
import { EvidenceBundlePayloadSchema } from '@intentsolutions/core/validators/v1/evidence-statement';
import { canonicalJsonBytes, sha256Key, stableStringify } from './content-address.js';

export type GateResultBindingCheck =
  | {
      readonly ok: true;
      readonly bodies: readonly GateResultV1[];
      readonly evidencePayload?: unknown;
    }
  | { readonly ok: false; readonly detail: string };

/**
 * Validate the producer contract for one signed manifest row.
 *
 * Canonical payloads support multiple statements. The legacy body-only format
 * remains restricted to one body and one subject, with its original digest.
 */
export function checkGateResultBinding(
  bundleRaw: unknown,
  gateResultsRaw: unknown,
  evidencePayloadRaw?: unknown,
): GateResultBindingCheck {
  const bundleResult = EvidenceBundleSchema.safeParse(bundleRaw);
  if (!bundleResult.success) {
    return { ok: false, detail: 'cannot bind gate results to an invalid EvidenceBundle' };
  }
  const bundle = bundleResult.data;

  if (evidencePayloadRaw !== undefined) {
    const payloadResult = EvidenceBundlePayloadSchema.safeParse(evidencePayloadRaw);
    if (!payloadResult.success) {
      return { ok: false, detail: 'evidencePayload is not a kernel EvidenceBundlePayload' };
    }
    const payload = payloadResult.data;
    if (bundle.storage_key !== sha256Key(canonicalJsonBytes(evidencePayloadRaw))) {
      return { ok: false, detail: 'evidencePayload digest does not match signed storage_key' };
    }
    if (bundle.row_count !== payload.length) {
      return { ok: false, detail: 'evidencePayload length does not match signed row_count' };
    }

    const subjects = new Set(payload.flatMap((row) => row.subject.map(stableStringify)));
    const signedSubjects = bundle.subject_set.map(stableStringify);
    if (
      subjects.size !== signedSubjects.length ||
      new Set(signedSubjects).size !== signedSubjects.length ||
      signedSubjects.some((subject) => !subjects.has(subject))
    ) {
      return { ok: false, detail: 'evidencePayload subjects do not match signed subject_set' };
    }
    const predicates = new Set<string>(payload.map((row) => row.predicateType));
    if (
      predicates.size !== bundle.predicate_uri_set.length ||
      new Set(bundle.predicate_uri_set).size !== bundle.predicate_uri_set.length ||
      bundle.predicate_uri_set.some((uri) => !predicates.has(uri))
    ) {
      return {
        ok: false,
        detail: 'evidencePayload predicates do not match signed predicate_uri_set',
      };
    }

    const bodies = payload.map((row) => row.predicate);
    // A redundant projection is allowed for transitional producers and stored
    // sidecars, but it cannot disagree with the content-addressed statements.
    if (
      gateResultsRaw !== undefined &&
      stableStringify(gateResultsRaw) !== stableStringify(bodies)
    ) {
      return { ok: false, detail: 'gateResults do not match evidencePayload predicates' };
    }
    return { ok: true, bodies, evidencePayload: evidencePayloadRaw };
  }

  if (!Array.isArray(gateResultsRaw)) {
    return { ok: false, detail: 'gateResults must be an array' };
  }
  if (bundle.row_count !== 1 || gateResultsRaw.length !== 1) {
    return {
      ok: false,
      detail:
        `v1 requires exactly one gate result per bundle ` +
        `(bundle row_count=${bundle.row_count}, manifest bodies=${gateResultsRaw.length})`,
    };
  }
  if (!bundle.predicate_uri_set.includes(GATE_RESULT_V1_URI)) {
    return { ok: false, detail: `bundle does not claim ${GATE_RESULT_V1_URI}` };
  }

  const bodyRaw: unknown = gateResultsRaw[0];
  const bodyResult = GateResultV1Schema.safeParse(bodyRaw);
  if (!bodyResult.success) {
    return { ok: false, detail: 'gateResults[0] is not a kernel gate-result/v1 body' };
  }
  const body = bodyResult.data;
  const expectedStorageKey = sha256Key(canonicalJsonBytes(bodyRaw));
  if (bundle.storage_key !== expectedStorageKey) {
    return {
      ok: false,
      detail: `gateResults[0] canonical digest does not match signed bundle storage_key`,
    };
  }

  if (bundle.subject_set.length !== 1) {
    return {
      ok: false,
      detail: `v1 requires exactly one signed subject (found ${bundle.subject_set.length})`,
    };
  }
  const subject = bundle.subject_set[0]!;
  // GateResultV1Schema guarantees the sha256: prefix.
  const inputDigest = body.input_hash.slice('sha256:'.length);
  if (subject.name !== body.gate_id || subject.digest.sha256 !== inputDigest) {
    return {
      ok: false,
      detail: 'gateResults[0] identity/input digest does not match signed bundle subject_set',
    };
  }

  return { ok: true, bodies: [body] };
}
