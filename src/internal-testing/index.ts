/**
 * Internal testing-dashboard module public surface (Pillar 1 — bead nr75.1/.2).
 *
 * The GATED testing dashboard (basicauth at internal.intentsolutions.io): joins
 * verified `gate-result/v1` rows with authored explainers + an auto verdict +
 * a what-to-fix list, and emits self-contained HTML under
 * `site-internal/internal/testing/`. The teaching/learning face of the platform.
 *
 * See `src/ingest/renderer.ts` for the upstream verified INPUT seam, and the
 * design DR (`intent-eval-dashboard/000-docs/`) + the DR-035 § 8 successor-DR
 * addendum (`intent-eval-lab/000-docs/040-AT-DECR-...`) for the gate decision.
 */

// --- view-model + resolver seam (richer gate-result/v1 projection) ---
export {
  buildTestingRepo,
  buildTestingView,
  type CoverageDecl,
  type GateDecision,
  type ResolvedTestingRow,
  type TestingBundleResolver,
  type TestingRepo,
  type TestingRow,
  type TestingView,
} from './testing-row.js';

// --- the auto verdict (decision → plain-English reading + fixes) ---
export { deriveVerdict, VERDICT_WEIGHT, type Verdict, type VerdictKind } from './verdict.js';

// --- authored explainer loader ---
export {
  explainerFor,
  GENERIC_EXPLAINER_KEY,
  INDEX_EXPLAINER_KEY,
  loadExplainers,
  type ExplainerDoc,
  type ExplainerSet,
} from './explainers.js';

// --- minimal markdown renderer (explainer prose → safe HTML) ---
export { renderMarkdown } from './markdown.js';

// --- HTML rendering (gated testing surface) ---
export {
  pathFromTestingUrl,
  renderTestingIndex,
  renderTestingRepoPage,
  testingRepoUrl,
  verdictBadge,
} from './render-testing.js';

// --- generator (data → site-internal/internal/testing/) ---
export {
  generateTestingFiles,
  writeTestingSite,
  type TestingGeneratedFile,
} from './generate-testing.js';

// --- production resolver (live ingest: content store + gate-row store → rows) ---
export { StoreTestingResolver } from './store-testing-resolver.js';
