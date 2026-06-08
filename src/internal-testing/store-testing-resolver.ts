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
import { type ContentStore } from '../ingest/interfaces.js';
import { type GateRowStore } from '../ingest/gate-row-store.js';
import {
  type GateDecision,
  type ResolvedTestingRow,
  type TestingBundleResolver,
} from './testing-row.js';

function coerceDecision(value: unknown): GateDecision {
  return value === 'pass' || value === 'fail' || value === 'advisory' || value === 'error'
    ? value
    : 'error';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

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
    if (stored === null || stored.bodies.length === 0) return null;

    const predicateUri = bundle.predicate_uri_set[0] ?? GATE_RESULT_V1_URI;
    const rows: ResolvedTestingRow[] = stored.bodies.map((b) => {
      const body = b as Record<string, unknown>;
      const cov = (typeof body['coverage'] === 'object' && body['coverage'] !== null
        ? body['coverage']
        : {}) as Record<string, unknown>;
      const failureMode = body['failure_mode'];
      const advisorySeverity = body['advisory_severity'];
      return {
        predicateUri,
        gateId: typeof body['gate_id'] === 'string' ? body['gate_id'] : '',
        gateName: typeof body['gate_name'] === 'string' ? body['gate_name'] : 'unknown',
        gateVersion: typeof body['gate_version'] === 'string' ? body['gate_version'] : '0.0.0',
        decision: coerceDecision(body['gate_decision']),
        gateReasons: asStringArray(body['gate_reasons']),
        coverage: {
          dimensionsEvaluated: asStringArray(cov['dimensions_evaluated']),
          dimensionsSkipped: asStringArray(cov['dimensions_skipped']),
        },
        evaluatedAt: typeof body['evaluated_at'] === 'string' ? body['evaluated_at'] : '',
        bundleCreatedAt: bundle.created_at,
        rekorLogIndices: bundle.rekor_log_indices,
        ...(typeof failureMode === 'string' ? { failureMode } : {}),
        ...(advisorySeverity === 'info' || advisorySeverity === 'warn' || advisorySeverity === 'error'
          ? { advisorySeverity }
          : {}),
      };
    });
    return rows.length > 0 ? rows : null;
  }
}
