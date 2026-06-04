/**
 * Freshness + decision-mix strip + USE-method /status surface (puxu.7 / Epic 2.4).
 *
 * Re-exports the pure model + renderer + generator so consumers (the CLI
 * entrypoint, tests, and a future tailnet-internal status view) import from one
 * place. Explicit named exports (not `export *`) so the umbrella `src/index.ts`
 * can re-export both `results` and `freshness` without name collisions.
 */

// --- bucket model (pure 24-bucket decision-mix) ---
export {
  BUCKET_COUNT,
  buildFreshnessStrip,
  type BucketKind,
  type DecisionBucket,
  type FreshnessRowInput,
  type FreshnessStripView,
  type RepoFreshnessRow,
} from './bucket-model.js';

// --- USE-method model (ingest pipeline observability) ---
export {
  computeIngestUse,
  type ErrorsView,
  type IngestUseView,
  type RepoLiveness,
  type SaturationView,
  type SupervisionPressure,
  type UtilizationView,
} from './use-model.js';

// --- HTML rendering ---
export { renderFreshnessStrip, renderStatusPage } from './render-strip.js';

// --- generator (data → site) ---
export {
  buildFreshness,
  generateAndWrite,
  generateFreshnessFiles,
  injectStrip,
  STRIP_MARKER_CLOSE,
  STRIP_MARKER_OPEN,
  writeFreshnessSite,
  type FreshnessBuild,
  type FreshnessGeneratedFile,
  type FreshnessInputs,
} from './generate.js';
