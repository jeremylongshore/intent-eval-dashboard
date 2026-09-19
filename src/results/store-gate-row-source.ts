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
import { checkGateResultBinding } from '../ingest/gate-result-binding.js';
import { type GateRowStore } from '../ingest/gate-row-store.js';
import { type GateRowProjection, type GateRowSource } from './bundle-resolver.js';
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

/** Resolves gate-result rows for a bundle key out of the gate-row store. */
export class StoreGateRowSource implements GateRowSource {
  constructor(private readonly store: GateRowStore) {}

  async rowsFor(bundleKey: string, bundle: unknown): Promise<readonly GateRowProjection[] | null> {
    const stored = await this.store.get(bundleKey);
    if (stored === null) return null;
    const binding = checkGateResultBinding(bundle, stored.bodies);
    if (!binding.ok) return null;
    const visibility = repoVisibility(stored.repo);
    const rows: GateRowProjection[] = binding.bodies.map((body) => {
      return {
        predicateUri: GATE_RESULT_V1_URI,
        decision: body.gate_decision,
        gateName: body.gate_name,
        evaluatedAt: body.evaluated_at,
        visibility,
      };
    });
    return rows.length > 0 ? rows : null;
  }
}
