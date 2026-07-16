/**
 * Production {@link GateRowSource} backed by the gate-row store (live ingest).
 *
 * Pairs with the existing {@link ContentStoreBundleResolver}: that resolver reads
 * the verified EvidenceBundle from the content store; this source supplies the
 * gate-result rows the worker persisted for that bundle key (in `gateResults`).
 * Together they reconstruct renderable rows from purely verified material.
 *
 * Visibility is assigned per source repo from the DR-035 C2 policy: the eight
 * IS-internal platform repos are Tier-1 (eventually-public), so their rows render
 * on the public surface; an unrecognised repo fails closed to Tier-2 (absent
 * from public output until consent).
 */

import { GATE_RESULT_V1_URI } from '@intentsolutions/core/validators/v1/gate-result-v1';
import { type GateRowStore } from '../ingest/gate-row-store.js';
import { type GateRowProjection, type GateRowSource } from './bundle-resolver.js';
import { type GateDecisionView } from './row-model.js';
import { type RowVisibility } from './visibility.js';

/** The eight IS-internal platform repos (Tier-1 per DR-035 C2). */
const IS_TIER1_REPOS: ReadonlySet<string> = new Set([
  'iec',
  'iel',
  'iah',
  'iaj',
  'iar',
  'ccp',
  'jrig',
  'qmd',
]);

/** Per-repo render visibility. Unknown repo → Tier-2 (fail-closed, not public). */
export function repoVisibility(repo: string): RowVisibility {
  return IS_TIER1_REPOS.has(repo) ? { tier: 'tier-1' } : { tier: 'tier-2' };
}

/** Coerce a raw gate_decision to the closed view enum (fail-closed to error). */
export function coerceDecision(value: unknown): GateDecisionView {
  return value === 'pass' || value === 'fail' || value === 'advisory' || value === 'error'
    ? value
    : 'error';
}

/** Resolves gate-result rows for a bundle key out of the gate-row store. */
export class StoreGateRowSource implements GateRowSource {
  constructor(private readonly store: GateRowStore) {}

  async rowsFor(bundleKey: string): Promise<readonly GateRowProjection[] | null> {
    const stored = await this.store.get(bundleKey);
    if (stored === null) return null;
    const visibility = repoVisibility(stored.repo);
    const rows: GateRowProjection[] = stored.bodies.map((b) => {
      const body = b as Record<string, unknown>;
      return {
        predicateUri: GATE_RESULT_V1_URI,
        decision: coerceDecision(body['gate_decision']),
        gateName: typeof body['gate_name'] === 'string' ? body['gate_name'] : 'unknown',
        evaluatedAt: typeof body['evaluated_at'] === 'string' ? body['evaluated_at'] : '',
        visibility,
      };
    });
    return rows.length > 0 ? rows : null;
  }
}
