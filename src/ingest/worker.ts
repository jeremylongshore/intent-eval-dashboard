/**
 * The per-repo ingest worker — the 8-step B1 verify-before-render contract.
 *
 * DR-035 § 4.B / amber-lighthouse Epic 2.2. SECURITY-CRITICAL.
 *
 * The hard binding (CTO + CISO independent refusals): "render-without-reverify"
 * is forbidden. This worker FAILS CLOSED — on ANY verification failure it
 * crashes with a structured {@link IngestReason} and writes NOTHING to staging.
 * The supervisor then marks the repo stale and the renderer keeps serving the
 * PRIOR good snapshot (never the unverified one).
 *
 * Ordering is load-bearing and enforced:
 *   1. fetch manifest
 *   2. OIDC issuer + subject + workflow_ref vs pinned allowlist
 *   3. Rekor inclusion proof, row-by-row
 *   4. DSSE signature, row-by-row
 *   5. kernel schema validation, row-by-row
 *   6. content-address each verified bundle by sha256
 *   7. emit snapshot + set last_known_good_ingested_at
 *   8. (any failure above) → crash with structured reason
 *
 * The snapshot is emitted ONLY after every row clears steps 3-6, so a tampered
 * row can never leave a half-written snapshot behind.
 */

import { canonicalJsonBytes } from './content-address.js';
import {
  type ContentStore,
  type IngestClock,
  type IngestSnapshot,
  type ManifestFetcher,
  type SigstoreVerifier,
  type SnapshotStore,
  VerifyFailure,
} from './interfaces.js';
import { isReportManifestShape } from './manifest.js';
import { checkOidcAllowlist, type PinnedSubjects } from './oidc-allowlist.js';
import {
  IngestCrash,
  type IngestReason,
  type IngestReasonCode,
  type IngestStep,
} from './reason.js';
import { validateEvidenceBundle } from './schema-validate.js';

/** Everything a worker needs, all behind interfaces (deterministically testable). */
export interface IngestWorkerDeps {
  readonly fetcher: ManifestFetcher;
  readonly verifier: SigstoreVerifier;
  readonly contentStore: ContentStore;
  readonly snapshotStore: SnapshotStore;
  readonly clock: IngestClock;
  /** The loaded pinned allowlist (`ingest/pinned-subjects.json`). */
  readonly pinned: PinnedSubjects;
}

function crash(
  repo: string,
  step: IngestStep,
  reasonCode: IngestReasonCode,
  detail: string,
  rowIndex?: number,
): never {
  const reason: IngestReason =
    rowIndex === undefined
      ? { repo, step, reasonCode, detail }
      : { repo, step, reasonCode, detail, rowIndex };
  throw new IngestCrash(reason);
}

/**
 * Map a {@link VerifyFailure.kind} to the correct crash step + reason code.
 * Step 3 (Rekor inclusion) and step 4 (DSSE signature) are distinct steps;
 * an identity mismatch surfaced by the cryptographic verifier is attributed to
 * step 4's DSSE check (the cert/identity binding lives with signature verify).
 */
function crashFromVerifyFailure(repo: string, rowIndex: number, failure: VerifyFailure): never {
  switch (failure.kind) {
    case 'rekor_inclusion':
      return crash(
        repo,
        'verify_rekor_inclusion',
        'rekor_inclusion_invalid',
        failure.message,
        rowIndex,
      );
    case 'dsse_signature':
      return crash(
        repo,
        'verify_dsse_signature',
        'dsse_signature_invalid',
        failure.message,
        rowIndex,
      );
    case 'identity_mismatch':
      return crash(
        repo,
        'verify_dsse_signature',
        'dsse_signature_invalid',
        failure.message,
        rowIndex,
      );
  }
}

/**
 * Run one ingest pass for `repo`. Resolves with the emitted snapshot on full
 * success; throws {@link IngestCrash} on any verification failure.
 *
 * This is the function each supervised `ingest_worker:<repo>` child runs.
 */
export async function runIngestWorker(
  repo: string,
  deps: IngestWorkerDeps,
): Promise<IngestSnapshot> {
  // --- Step 1: fetch manifest ---
  let manifestRaw: unknown;
  try {
    manifestRaw = await deps.fetcher.fetch(repo);
  } catch (err: unknown) {
    return crash(
      repo,
      'fetch_manifest',
      'manifest_unreachable',
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!isReportManifestShape(manifestRaw)) {
    return crash(
      repo,
      'fetch_manifest',
      'manifest_malformed',
      'manifest failed structural shape check',
    );
  }
  const manifest = manifestRaw;

  // --- Step 2: OIDC issuer + subject + workflow_ref vs pinned allowlist ---
  const oidc = checkOidcAllowlist(deps.pinned, repo, manifest.signing);
  if (!oidc.ok) {
    return crash(repo, 'verify_oidc', oidc.code, oidc.detail);
  }

  // Verify each row through steps 3, 4, 5, 6. Accumulate content keys; emit only
  // after ALL rows clear (verify-before-render — no partial snapshot on failure).
  const bundleKeys: string[] = [];

  for (let i = 0; i < manifest.rows.length; i++) {
    const row = manifest.rows[i];
    /* v8 ignore next -- index in range; guard only for noUncheckedIndexedAccess. */
    if (row === undefined) continue;

    // Canonical bytes the DSSE envelope attests to + we content-address.
    const payloadBytes = canonicalJsonBytes(row.bundle);

    // --- Steps 3 + 4: Rekor inclusion + DSSE signature (REAL crypto) ---
    try {
      await deps.verifier.verifyRow({
        sigstoreBundle: row.sigstoreBundle,
        payloadBytes,
        expectedIdentity: manifest.signing,
      });
    } catch (err: unknown) {
      if (err instanceof VerifyFailure) {
        return crashFromVerifyFailure(repo, i, err);
      }
      // A non-VerifyFailure throw from a verifier is treated as a DSSE-step
      // failure (fail-closed — an unexpected verifier error must not pass).
      return crash(
        repo,
        'verify_dsse_signature',
        'dsse_signature_invalid',
        `verifier threw: ${err instanceof Error ? err.message : String(err)}`,
        i,
      );
    }

    // --- Step 5: kernel schema validation (REAL @intentsolutions/core Zod) ---
    const schema = validateEvidenceBundle(row.bundle);
    if (!schema.ok) {
      return crash(repo, 'validate_schema', 'schema_invalid', schema.detail, i);
    }

    // --- Step 6: content-address by sha256 ---
    let key: string;
    try {
      key = await deps.contentStore.put(payloadBytes);
    } catch (err: unknown) {
      return crash(
        repo,
        'content_address',
        'content_address_failed',
        err instanceof Error ? err.message : String(err),
        i,
      );
    }
    bundleKeys.push(key);
  }

  // --- Step 7: emit snapshot + set last_known_good_ingested_at ---
  const snapshot: IngestSnapshot = {
    repo,
    lastKnownGoodIngestedAt: deps.clock.nowIso(),
    sourceSha: manifest.rows[0]?.sourceSha ?? '',
    bundleKeys,
  };
  try {
    await deps.snapshotStore.put(snapshot);
  } catch (err: unknown) {
    return crash(
      repo,
      'emit_snapshot',
      'snapshot_emit_failed',
      err instanceof Error ? err.message : String(err),
    );
  }

  return snapshot;
}
