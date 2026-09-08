/**
 * Verify that the gate-result body adjacent to a signed EvidenceBundle is the
 * exact body the signed bundle commits to.
 *
 * The kernel EvidenceBundle is strict metadata and cannot embed predicate
 * bodies. Producers therefore place `gateResults` beside the signed bundle in
 * report-manifest.json and commit to the canonical body through storage_key,
 * subject_set, row_count, and predicate_uri_set. Every relationship is checked
 * here before the body can reach a GateRowStore. This is the bounded legacy
 * single-row producer contract; migration to the kernel's canonical
 * EvidenceBundlePayload array is tracked separately.
 */

import {
  GateResultV1Schema,
  GATE_RESULT_V1_URI,
  type GateResultV1,
} from '@intentsolutions/core/validators/v1/gate-result-v1';
import { EvidenceBundleSchema } from '@intentsolutions/core/validators/v1/evidence-bundle';
import { canonicalJsonBytes, sha256Key } from './content-address.js';

export type GateResultBindingCheck =
  | { readonly ok: true; readonly bodies: readonly GateResultV1[] }
  | { readonly ok: false; readonly detail: string };

/**
 * Validate the producer contract for one signed manifest row.
 *
 * v1 intentionally supports exactly one gate-result body per EvidenceBundle.
 * No multi-row digest convention exists yet, so accepting a larger row_count
 * would create an unsigned ambiguity. A future batching contract must be
 * versioned and implemented on both producer and consumer before use.
 */
export function checkGateResultBinding(
  bundleRaw: unknown,
  gateResultsRaw: unknown,
): GateResultBindingCheck {
  const bundleResult = EvidenceBundleSchema.safeParse(bundleRaw);
  if (!bundleResult.success) {
    return { ok: false, detail: 'cannot bind gate results to an invalid EvidenceBundle' };
  }
  const bundle = bundleResult.data;

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
