/**
 * Step 6 — content addressing by sha256.
 *
 * Content-addressing means a verified bundle is stored under the hash of its
 * own bytes. This is what makes a deep link SURVIVE a source-side force-push or
 * SHA deletion: the dashboard never points at the source git SHA — it points at
 * the bundle's content hash, which we hold a copy of.
 */

import { createHash } from 'node:crypto';

/** `sha256:<hex>` of the given bytes. */
export function sha256Key(bytes: Uint8Array): string {
  const hex = createHash('sha256').update(bytes).digest('hex');
  return `sha256:${hex}`;
}

/** Canonical UTF-8 bytes of a JSON value (stable key ordering). */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(stableStringify(value));
}

/**
 * Deterministic JSON stringify with sorted object keys. Ensures the same
 * logical bundle always hashes to the same content key regardless of key order
 * in the source manifest.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortDeep(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}
