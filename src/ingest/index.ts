/**
 * Ingest module public surface.
 *
 * The verify-before-render ingest pipeline + supervision-tree assembly for the
 * Intent Eval Platform public dashboard (DR-035 § 4.B / amber-lighthouse
 * Epic 2.2). See `README.md` in this directory for the architecture + the
 * production-wired vs interface-seamed map.
 */

// --- structured crash reasons ---
export {
  IngestCrash,
  isIngestCrash,
  type IngestReason,
  type IngestReasonCode,
  type IngestStep,
} from './reason.js';

// --- manifest ---
export {
  isReportManifestShape,
  type ManifestRow,
  type ManifestSigningClaims,
  type ReportManifest,
} from './manifest.js';

// --- injectable interfaces ---
export {
  VerifyFailure,
  type ContentStore,
  type IngestClock,
  type IngestSnapshot,
  type ManifestFetcher,
  type SigstoreVerifier,
  type SnapshotStore,
  type VerifyFailureKind,
  type VerifyRowInput,
} from './interfaces.js';

// --- step 2: OIDC allowlist (pure) + loader ---
export {
  checkOidcAllowlist,
  matchesPinnedPattern,
  type OidcCheckResult,
  type PinnedRepoEntry,
  type PinnedSubjects,
} from './oidc-allowlist.js';
export {
  defaultPinnedSubjectsPath,
  loadPinnedSubjects,
  parsePinnedSubjects,
} from './pinned-loader.js';

// --- step 5: schema validation (kernel-backed) ---
export { validateEvidenceBundle, type SchemaCheckResult } from './schema-validate.js';

// --- step 6: content addressing ---
export {
  canonicalJsonBytes,
  sha256Key,
  stableStringify,
} from './content-address.js';

// --- storage ---
export { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
export {
  DEFAULT_STORAGE_ROOT,
  FsContentStore,
  FsSnapshotStore,
  systemIngestClock,
} from './storage-fs.js';

// --- verifiers (production sigstore + offline real-crypto) ---
export { SigstoreRowVerifier } from './verifier-sigstore.js';
export {
  OfflineRowVerifier,
  computeMerkleRootHex,
  dssePae,
  merkleLeafHashHex,
  type DsseEnvelope,
  type MerkleInclusionProof,
  type OfflineBundle,
} from './verifier-offline.js';

// --- fetcher ---
export { HttpManifestFetcher, type ManifestUrlResolver } from './fetcher-http.js';

// --- worker (the 8-step contract) ---
export { runIngestWorker, type IngestWorkerDeps } from './worker.js';

// --- renderer + publisher nodes ---
export {
  Renderer,
  buildRenderInput,
  type RenderInput,
  type RenderRepoState,
  type RenderSink,
  type RepoPassOutcome,
} from './renderer.js';
export {
  Publisher,
  type PublishRequest,
  type PublishResult,
  type PublisherTransport,
} from './publisher.js';
export { NoopPublisherTransport, type NoopLogger } from './publisher-transport-noop.js';

// --- tree assembly ---
export {
  DEFAULT_INGEST_BUDGET,
  INGEST_REPOS,
  buildDeploySupervisorSpec,
  buildIngestSupervisorSpec,
  runDeployPass,
  type DeployPassResult,
  type IngestRepo,
} from './tree.js';
