/**
 * Injectable I/O seams for the ingest worker.
 *
 * Every external dependency the 8-step contract touches is behind an interface
 * so the whole pipeline is deterministically testable: tests inject fixtures
 * (known-good and tampered) and assert the worker fails CLOSED on tampering.
 *
 * Production default implementations live in sibling files
 * (`fetcher-http.ts`, `verifier-sigstore.ts`, `storage-fs.ts`). The defaults
 * perform REAL verification — no no-op stubs that pretend to verify.
 */

import { type ManifestSigningClaims, type ReportManifest } from './manifest.js';

/** Step 1 — fetches a repo's `report-manifest.json` from its CI artifact. */
export interface ManifestFetcher {
  /** Resolve the manifest for `repo`, or reject if unreachable/malformed. */
  fetch(repo: string): Promise<ReportManifest>;
}

/**
 * Steps 3 + 4 — verifies a single row's sigstore bundle.
 *
 * A successful return means BOTH:
 *   - the Rekor inclusion proof is valid (the entry is in the transparency
 *     log — step 3), AND
 *   - the DSSE envelope signature verifies against the signing certificate
 *     (step 4), AND
 *   - the signing certificate's identity matches `expectedIdentity` (the
 *     pinned OIDC subject + issuer — cryptographic binding of step 2).
 *
 * The verifier MUST reject (throw / reject) on ANY of: missing inclusion
 * proof, invalid Merkle path, bad signature, or identity mismatch. The worker
 * translates the rejection into the appropriate {@link IngestStep} crash by
 * inspecting which sub-check the implementation reports.
 */
export interface SigstoreVerifier {
  /**
   * Verify one row. `payloadBytes` is the canonical bytes the DSSE envelope
   * signs (the bundle payload). Resolves on full success; rejects with a
   * {@link VerifyFailure} on any failure.
   */
  verifyRow(input: VerifyRowInput): Promise<void>;
}

/** What the {@link SigstoreVerifier} needs to verify one row. */
export interface VerifyRowInput {
  /** The serialized sigstore bundle (DSSE + cert chain + inclusion proof). */
  readonly sigstoreBundle: unknown;
  /** Canonical bytes the DSSE envelope must attest to. */
  readonly payloadBytes: Uint8Array;
  /** The pinned identity the signing cert MUST match (issuer + subject). */
  readonly expectedIdentity: ManifestSigningClaims;
}

/** Which sub-check failed — lets the worker pick the right crash step. */
export type VerifyFailureKind = 'rekor_inclusion' | 'dsse_signature' | 'identity_mismatch';

/** Rejection from a {@link SigstoreVerifier}. */
export class VerifyFailure extends Error {
  public readonly kind: VerifyFailureKind;
  constructor(kind: VerifyFailureKind, detail: string) {
    super(detail);
    this.name = 'VerifyFailure';
    this.kind = kind;
  }
}

/**
 * Step 6 — content-addressed object storage.
 *
 * `put` stores bytes under their sha256 (returned as the storage key) and is
 * idempotent: storing the same bytes twice yields the same key and does not
 * error. `get` retrieves by content hash — this is what lets a deep link
 * survive a source-side force-push / SHA deletion.
 */
export interface ContentStore {
  /** Store bytes; return the `sha256:<hex>` content key. */
  put(bytes: Uint8Array): Promise<string>;
  /** Retrieve bytes by `sha256:<hex>` key, or null if absent. */
  get(key: string): Promise<Uint8Array | null>;
  /** True if a key exists. */
  has(key: string): Promise<boolean>;
}

/** Step 7 — emits an ingest snapshot to the staging area. */
export interface SnapshotStore {
  /** Persist (replace) the snapshot for a repo. */
  put(snapshot: IngestSnapshot): Promise<void>;
  /** Read the current snapshot for a repo, or null if none. */
  get(repo: string): Promise<IngestSnapshot | null>;
}

/** A verified ingest snapshot for one repo (step 7 output). */
export interface IngestSnapshot {
  readonly repo: string;
  /** ISO-8601 timestamp the snapshot was verified + emitted. */
  readonly lastKnownGoodIngestedAt: string;
  /** The source SHA the manifest pointed at (provenance). */
  readonly sourceSha: string;
  /** Content keys (sha256) of every verified bundle, in row order. */
  readonly bundleKeys: readonly string[];
}

/** Injectable clock for deterministic timestamps. */
export interface IngestClock {
  /** ISO-8601 now. */
  nowIso(): string;
  /** Epoch ms now. */
  nowMs(): number;
}
