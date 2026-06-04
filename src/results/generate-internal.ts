/**
 * Operator-internal results generator — the data → site step for the
 * TAILNET-ONLY operator view (bead puxu.9 / amber-lighthouse Epic 2.6).
 *
 * This is the INVERSE of the public generator (`generate.ts`). The public
 * generator applies `filterPubliclyVisible` so Tier-2-no-consent / Tier-3 /
 * Tier-1-under-embargo rows are ABSENT. This generator does NOT call that
 * filter — it renders EVERY verified row, annotated with its visibility tier, so
 * an operator on the tailnet sees the complete picture including the rows the
 * public site hides.
 *
 * Pipeline (each step pure + testable, mirroring `generate.ts`):
 *
 *   RenderInput  (verified snapshots + staleSince, from src/ingest/renderer.ts)
 *        │  buildResultsView + BundleResolver  → resolves content keys to rows
 *        ▼                                        (NO public-visibility filter)
 *   ResultsView  (ALL rows, every tier)
 *        │  buildInternalUse                    → USE-method view (reused model)
 *        ▼
 *   generateInternalFiles                       → { path → html } map under
 *        │                                        `internal/results/...`
 *        ▼
 *   writeInternalSite                            → writes the map under
 *                                                  `site-internal/` (NEVER site/)
 *
 * ── HARD SEPARATION (the whole reason puxu.9 exists) ──
 *
 * Output is written under `site-internal/` — a directory the PUBLIC deploy never
 * serves. The public Caddy block serves `site/`; a future, human-gated,
 * Tailscale-identity-gated Caddy block will serve `site-internal/`. The public
 * `deploy.yml` only globs `site/**` (its `paths:` trigger, its smoke-file
 * checks, and its C3 scan all target `site`), so `site-internal/` is never wired
 * into the public origin. See the README "Operator-internal view" section.
 *
 * ── C3 SAFETY ──
 *
 * Showing every tier does NOT relax the C3 binding: the internal renderer reuses
 * the SAME per-predicate breakdown (counts within one predicate URI only) and
 * emits no cross-predicate `X/N pass` / `X% pass` token. `site-internal/` output
 * is C3-clean exactly like `site/`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type RenderInput } from '../ingest/renderer.js';
import {
  computeIngestUse,
  type IngestUseView,
  type RepoLiveness,
  type SupervisionPressure,
} from '../freshness/use-model.js';
import { buildFreshnessStrip } from '../freshness/bucket-model.js';
import {
  buildResultsView,
  type BundleResolver,
  type ResultsRow,
  type ResultsView,
} from './row-model.js';
import {
  internalBundleUrl,
  internalRepoUrl,
  renderInternalBundlePage,
  renderInternalIndex,
  renderInternalRepoPage,
} from './render-internal.js';

/** A generated internal file: path under `site-internal/` → HTML content. */
export interface InternalGeneratedFile {
  /** Path relative to the internal site root, e.g. `internal/results/index.html`. */
  readonly path: string;
  readonly html: string;
}

/**
 * Build the FULL internal results view from raw render input.
 *
 * Convenience composition: resolve → build view. Deliberately does NOT apply
 * `filterPubliclyVisible` — that single omission is what makes this the operator
 * view (all tiers) rather than the public view.
 */
export async function buildInternalResultsView(
  input: RenderInput,
  resolver: BundleResolver,
): Promise<ResultsView> {
  return buildResultsView(input, resolver);
}

/**
 * Derive an honest USE-method view of the ingest pipeline from the built results
 * view, when the caller does not supply liveness/pressure directly.
 *
 * A repo is counted as a fresh worker iff it has at least one row AND is not
 * serving a stale (prior-good) snapshot. Restart pressure defaults to zero — the
 * wired Phase-2 run injects the real supervision report. This keeps the internal
 * index's USE view consistent with the no-data current state without inventing
 * saturation/error signal.
 */
export function deriveLiveness(view: ResultsView): RepoLiveness[] {
  return view.repos.map((r) => ({
    repo: r.repo,
    fresh: r.rows.length > 0 && r.staleSince === undefined,
    ...(r.staleSince !== undefined ? { staleSince: r.staleSince } : {}),
  }));
}

/** Build the USE view for the internal index from liveness + pressure + the view. */
export function buildInternalUse(
  view: ResultsView,
  nowIso: string,
  liveness?: readonly RepoLiveness[],
  pressure?: SupervisionPressure,
): IngestUseView {
  const live = liveness ?? deriveLiveness(view);
  const press: SupervisionPressure = pressure ?? {
    restartCount: 0,
    restartBudget: Math.max(1, live.length * 3),
    escalatedChildIds: [],
  };
  // The USE model wants a freshness strip only for the fully-silent-repos signal;
  // a repo with zero rows is fully silent. Build it from the per-repo row decisions.
  const strip = buildFreshnessStrip(
    view.repos.map((r) => r.repo),
    view.repos.flatMap((r) =>
      r.rows.map((row) => ({
        repo: row.repo,
        evaluatedAt: row.evaluatedAt,
        decision: row.decision,
      })),
    ),
    nowIso,
  );
  return computeIngestUse(live, press, strip, nowIso);
}

/**
 * Generate every operator-internal HTML file from a (NON-filtered) view + USE.
 *
 * Emits, all under the `internal/results/` URL space (written below
 * `site-internal/`):
 *   - `internal/results/index.html`                  — index + USE view + all tiers
 *   - `internal/results/<repo>/index.html`           — per-repo page
 *   - `internal/results/<repo>/<bundle>/index.html`  — per-bundle deep-link page
 *
 * Returns the file map WITHOUT touching disk so tests can assert structure +
 * the C3 scanner can run against the strings.
 */
export function generateInternalFiles(
  view: ResultsView,
  use: IngestUseView,
  nowIso: string,
): InternalGeneratedFile[] {
  const files: InternalGeneratedFile[] = [];

  files.push({
    path: 'internal/results/index.html',
    html: renderInternalIndex(view, use, nowIso),
  });

  for (const repo of view.repos) {
    files.push({
      path: pathFromInternalUrl(internalRepoUrl(repo.repo)),
      html: renderInternalRepoPage(view, repo, nowIso),
    });

    // Group this repo's rows by bundle key for the per-bundle deep links.
    const byBundle = new Map<string, ResultsRow[]>();
    for (const row of repo.rows) {
      const existing = byBundle.get(row.bundleKey);
      if (existing === undefined) {
        byBundle.set(row.bundleKey, [row]);
      } else {
        existing.push(row);
      }
    }
    for (const [bundleKey, rows] of byBundle) {
      files.push({
        path: pathFromInternalUrl(internalBundleUrl(repo.repo, bundleKey)),
        html: renderInternalBundlePage(repo.repo, bundleKey, rows, nowIso),
      });
    }
  }

  return files;
}

/** Turn an internal site URL like `/internal/results/iec/` into `internal/results/iec/index.html`. */
export function pathFromInternalUrl(url: string): string {
  const trimmed = url.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${trimmed}/index.html`;
}

/**
 * Write the generated internal files under `internalSiteRoot` (e.g.
 * `site-internal/`). Creates parent dirs as needed. Returns absolute paths
 * written.
 *
 * IMPORTANT: `internalSiteRoot` must NEVER be `site/` (the public origin). The
 * CLI entrypoint defaults it to `site-internal/`.
 */
export async function writeInternalSite(
  files: readonly InternalGeneratedFile[],
  internalSiteRoot: string,
): Promise<string[]> {
  const written: string[] = [];
  for (const file of files) {
    const abs = join(internalSiteRoot, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.html, 'utf8');
    written.push(abs);
  }
  return written;
}
