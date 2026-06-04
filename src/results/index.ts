/**
 * Results-browser module public surface.
 *
 * The public `/results/` generator: consumes the verified ingest RenderInput,
 * resolves content-addressed bundles to gate-result rows, applies the
 * visibility-tier gate, and emits self-contained HTML pages. Plus the C3
 * cross-predicate aggregate-PASS% scanner that the CI gate enforces.
 *
 * See `src/ingest/renderer.ts` for the upstream INPUT seam (RenderRepoState).
 */

// --- visibility-tier gating (pure, public-render rule) ---
export {
  decidePublicVisibility,
  filterPubliclyVisible,
  type PublicExclusionReason,
  type PublicVisibilityDecision,
  type RowVisibility,
  type VisibilityTier,
} from './visibility.js';

// --- view-model + resolver seam ---
export {
  buildRepoResults,
  buildResultsView,
  type BundleResolver,
  type GateDecisionView,
  type RepoResults,
  type ResolvedBundleRow,
  type ResultsRow,
  type ResultsView,
} from './row-model.js';
export {
  ContentStoreBundleResolver,
  type GateRowProjection,
  type GateRowSource,
} from './bundle-resolver.js';

// --- HTML rendering (public) ---
export {
  asOfBanner,
  bundleUrl,
  decisionBadge,
  esc,
  noDataPanel,
  perPredicateBreakdown,
  renderBundlePage,
  renderRepoPage,
  renderResultsIndex,
  repoUrl,
  SITE_FOOTER,
  SITE_HEADER,
  slug,
} from './render-html.js';

// --- HTML rendering (operator-internal, tailnet-only — puxu.9) ---
export {
  internalBundleUrl,
  internalRepoUrl,
  renderInternalBundlePage,
  renderInternalIndex,
  renderInternalRepoPage,
  visibilityBadge,
} from './render-internal.js';

// --- generator (public, data → site/) ---
export {
  applyPublicVisibility,
  buildPublicResultsView,
  generateResultsFiles,
  pathFromUrl,
  writeResultsSite,
  type GeneratedFile,
} from './generate.js';

// --- generator (operator-internal, data → site-internal/ — puxu.9) ---
export {
  buildInternalResultsView,
  buildInternalUse,
  deriveLiveness,
  generateInternalFiles,
  pathFromInternalUrl,
  writeInternalSite,
  type InternalGeneratedFile,
} from './generate-internal.js';

// --- C3 scanner ---
export {
  scanFiles,
  scanForAggregatePass,
  type C3FileResult,
  type C3Violation,
} from './c3-scan.js';
