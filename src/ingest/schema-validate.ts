/**
 * Step 5 — schema validation against the canonical kernel.
 *
 * REAL import + parse: this uses `@intentsolutions/core`'s Zod
 * `EvidenceBundleSchema` (v1 validators, kernel-pinned to ^0.2.0). No local
 * re-implementation of the schema — the kernel is the single source of truth
 * (anti-corruption-layer principle, per repo CLAUDE.md). A bundle that fails
 * the kernel's `.parse()` crashes the worker.
 */

import { EvidenceBundleSchema } from '@intentsolutions/core/validators/v1/evidence-bundle';

/** Result of step-5 validation. */
export type SchemaCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: string };

/**
 * Validate one bundle payload against the kernel's EvidenceBundle schema.
 * Returns ok/false rather than throwing so the worker owns the crash semantics.
 */
export function validateEvidenceBundle(bundle: unknown): SchemaCheckResult {
  const parsed = EvidenceBundleSchema.safeParse(bundle);
  if (parsed.success) {
    return { ok: true };
  }
  // Surface a compact issue summary (issue path + message) for the crash detail.
  const detail = parsed.error.issues
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
  return { ok: false, detail };
}
