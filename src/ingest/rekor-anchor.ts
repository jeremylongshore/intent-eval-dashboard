/**
 * Extract the Rekor transparency-log indices from a sigstore bundle that has
 * ALREADY been verified.
 *
 * ── Why this module exists ──
 *
 * The emitted `EvidenceBundle.rekor_log_indices` field cannot carry the real
 * anchor: the bundle bytes ARE the blob `cosign sign-blob` signs, so the log
 * index only exists AFTER the bytes are frozen. Writing it back would invalidate
 * the very signature the ingest worker verifies. The producing pipeline says so
 * in its emitter ("real index lives in the sigstore Bundle") — it just never
 * reached the render, so `labs.intentsolutions.io` printed an empty "Rekor
 * anchor" cell for evidence that IS anchored.
 *
 * The authoritative anchor is the `logIndex` of the transparency-log entries in
 * the sigstore bundle — the same entries the verifier checked an inclusion proof
 * for (`tlogThreshold >= 1`). This module reads that value and nothing else.
 *
 * ── Verify-before-render ──
 *
 * This function performs NO verification and must therefore only ever be called
 * on a sigstore bundle whose row already passed `runIngestWorker` (steps 3-6).
 * Its single production caller is `runLivePass`, after the worker resolved for
 * the whole manifest. It never fabricates: an absent, malformed, or
 * out-of-range index yields no entry rather than a guess.
 */

/** Parse one protobuf-JSON int64 (string or number) as a log index. */
function parseLogIndex(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * The Rekor log indices carried by an already-verified sigstore bundle.
 *
 * Understands both verifier shapes:
 *   - production sigstore bundle (`SigstoreRowVerifier`):
 *     `verificationMaterial.tlogEntries[].logIndex` — protobuf-JSON int64, so a
 *     decimal STRING on the wire (e.g. `"2746738668"`);
 *   - offline bundle (`OfflineRowVerifier`): `inclusionProof.leafIndex`, the
 *     leaf position in the Merkle tree the proof was checked against.
 *
 * Returns the indices in bundle order, de-duplicated. Returns `[]` for anything
 * it cannot read as a non-negative safe integer — an honest "unknown", never an
 * invented anchor.
 */
export function verifiedRekorLogIndices(sigstoreBundle: unknown): readonly number[] {
  if (typeof sigstoreBundle !== 'object' || sigstoreBundle === null) return [];
  const b = sigstoreBundle as Record<string, unknown>;
  const out: number[] = [];

  const material = b['verificationMaterial'];
  if (typeof material === 'object' && material !== null) {
    const entries = (material as Record<string, unknown>)['tlogEntries'];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) continue;
        const idx = parseLogIndex((entry as Record<string, unknown>)['logIndex']);
        if (idx !== null && !out.includes(idx)) out.push(idx);
      }
    }
  }

  const proof = b['inclusionProof'];
  if (typeof proof === 'object' && proof !== null) {
    const idx = parseLogIndex((proof as Record<string, unknown>)['leafIndex']);
    if (idx !== null && !out.includes(idx)) out.push(idx);
  }

  return out;
}
