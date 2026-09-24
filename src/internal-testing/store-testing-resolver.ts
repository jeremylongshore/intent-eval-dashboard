/**
 * Production {@link TestingBundleResolver} backed by the verified content store +
 * the gate-row store (live ingest).
 *
 * Reconstructs the RICHER teaching rows the internal testing dashboard renders:
 * reads the verified EvidenceBundle from the content store (re-validated against
 * the kernel schema) for `created_at` + `rekor_log_indices` + `predicate_uri_set`,
 * and the gate-result bodies the worker persisted (with `gate_reasons`,
 * `coverage`, `failure_mode`, …) from the gate-row store. Returns `null` for a
 * key it cannot resolve or whose bytes fail kernel validation — a no-data hole,
 * never a synthetic pass (verify-before-render).
 */

import { EvidenceBundleSchema } from '@intentsolutions/core/validators/v1/evidence-bundle';
import { GATE_RESULT_V1_URI } from '@intentsolutions/core/validators/v1/gate-result-v1';
import { checkGateResultBinding } from '../ingest/gate-result-binding.js';
import { type ContentStore } from '../ingest/interfaces.js';
import { type GateRowStore } from '../ingest/gate-row-store.js';
import { type ResolvedTestingRow, type TestingBundleResolver } from './testing-row.js';

/** Resolves a bundle key → richer testing rows from the content + gate-row stores. */
export class StoreTestingResolver implements TestingBundleResolver {
  constructor(
    private readonly contentStore: ContentStore,
    private readonly gateRowStore: GateRowStore,
  ) {}

  async resolve(bundleKey: string): Promise<readonly ResolvedTestingRow[] | null> {
    const bytes = await this.contentStore.get(bundleKey);
    if (bytes === null) return null;

    let bundleJson: unknown;
    try {
      bundleJson = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      return null;
    }
    const parsed = EvidenceBundleSchema.safeParse(bundleJson);
    if (!parsed.success) return null;
    const bundle = parsed.data;

    const stored = await this.gateRowStore.get(bundleKey);
    if (stored === null) return null;
    const binding = checkGateResultBinding(bundle, stored.bodies);
    if (!binding.ok) return null;

    const rows: ResolvedTestingRow[] = binding.bodies.map((body) => {
      return {
        predicateUri: GATE_RESULT_V1_URI,
        gateId: body.gate_id,
        gateName: body.gate_name,
        gateVersion: body.gate_version,
        decision: body.gate_decision,
        gateReasons: body.gate_reasons,
        coverage: {
          dimensionsEvaluated: body.coverage.dimensions_evaluated,
          dimensionsSkipped: body.coverage.dimensions_skipped,
        },
        evaluatedAt: body.evaluated_at,
        bundleCreatedAt: bundle.created_at,
        rekorLogIndices: bundle.rekor_log_indices,
        ...(body.failure_mode !== undefined ? { failureMode: body.failure_mode } : {}),
        ...(body.advisory_severity !== undefined
          ? { advisorySeverity: body.advisory_severity }
          : {}),
      };
    });
    return rows.length > 0 ? rows : null;
  }
}
