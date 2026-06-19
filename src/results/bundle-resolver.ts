/**
 * Production {@link BundleResolver} — content key → verified gate-result rows.
 *
 * Wraps the ingest {@link ContentStore} (so it reads ONLY content-addressed,
 * already-verified bundles — verify-before-render is preserved) + the canonical
 * kernel EvidenceBundle Zod validator (so the bytes are re-validated against
 * `@intentsolutions/core` before anything is projected for render).
 *
 * Two facts of the data model shape this resolver:
 *
 *   1. The content-addressed object is the **EvidenceBundle** payload. It is a
 *      manifest: `predicate_uri_set`, `created_at`, `rekor_log_indices`,
 *      `verification_status`, `subject_set` — NOT the gate-result/v1 predicate
 *      bodies. The kernel `EvidenceBundleSchema` is strict (no extra keys), so
 *      the gate-result bodies cannot be smuggled inside it.
 *
 *   2. The gate-result/v1 predicate bodies (which carry `gate_decision`,
 *      `gate_name`, `evaluated_at`) + each row's publish-visibility annotation
 *      are therefore supplied by a separate {@link GateRowSource} seam — in
 *      production, the rows the ingest worker resolved + content-addressed
 *      alongside the bundle; in tests, an in-memory fixture.
 *
 * The resolver returns `null` for a key it cannot resolve or whose bytes fail
 * kernel validation — a no-data hole, NEVER a synthetic pass.
 */

import { EvidenceBundleSchema } from '@intentsolutions/core/validators/v1/evidence-bundle';
import { type ContentStore } from '../ingest/interfaces.js';
import { type BundleResolver, type GateDecisionView, type ResolvedBundleRow } from './row-model.js';
import { type RowVisibility } from './visibility.js';

/**
 * Supplies the gate-result/v1 row projection for a content-addressed bundle.
 *
 * Keyed by the bundle's content key. Each entry is the per-row projection the
 * producing repo emitted (decision + gate name + evaluated_at + predicate URI +
 * visibility). Returning `null`/absent means the rows are not available — the
 * resolver then yields no rows for that bundle (a hole, not a pass).
 */
export interface GateRowSource {
  /** Gate-result rows for a bundle key, or null when unavailable. */
  rowsFor(bundleKey: string): Promise<readonly GateRowProjection[] | null>;
}

/** The per-row projection a {@link GateRowSource} returns. */
export interface GateRowProjection {
  readonly predicateUri: string;
  readonly decision: GateDecisionView;
  readonly gateName: string;
  /** RFC-3339 `evaluated_at` from the gate-result/v1 body. */
  readonly evaluatedAt: string;
  readonly visibility: RowVisibility;
}

/**
 * Resolves bundle keys against the verified content store + kernel validator,
 * pairing each kernel-validated EvidenceBundle with its gate-result rows.
 */
export class ContentStoreBundleResolver implements BundleResolver {
  constructor(
    private readonly contentStore: ContentStore,
    private readonly gateRows: GateRowSource,
  ) {}

  async resolve(bundleKey: string): Promise<readonly ResolvedBundleRow[] | null> {
    const bytes = await this.contentStore.get(bundleKey);
    if (bytes === null) return null;

    // Re-validate against the canonical kernel schema before projecting. A
    // bundle that does not parse is a no-data hole, never rendered.
    let bundleJson: unknown;
    try {
      bundleJson = JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch {
      return null;
    }
    const parsed = EvidenceBundleSchema.safeParse(bundleJson);
    if (!parsed.success) return null;
    const bundle = parsed.data;

    // The gate-result bodies live outside the strict EvidenceBundle; fetch them.
    const projections = await this.gateRows.rowsFor(bundleKey);
    if (projections === null || projections.length === 0) return null;

    // Only surface rows whose predicate URI is one the bundle actually attests
    // to (defence in depth — a projection cannot smuggle a predicate the
    // verified bundle never claimed).
    const claimed = new Set(bundle.predicate_uri_set);
    const rows: ResolvedBundleRow[] = [];
    for (const p of projections) {
      if (!claimed.has(p.predicateUri)) continue;
      rows.push({
        predicateUri: p.predicateUri,
        decision: p.decision,
        gateName: p.gateName,
        evaluatedAt: p.evaluatedAt,
        bundleCreatedAt: bundle.created_at,
        rekorLogIndices: bundle.rekor_log_indices,
        visibility: p.visibility,
      });
    }
    return rows.length > 0 ? rows : null;
  }
}
