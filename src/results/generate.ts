/**
 * Results-browser generator — the data → site step for `/results/`.
 *
 * This is the TypeScript analogue of `scripts/regenerate.py` (which generates
 * the eval-set pages): it consumes the renderer's verified {@link RenderInput},
 * applies the PUBLIC visibility-tier filter, builds the results view, and emits
 * the self-contained HTML pages under `site/results/`.
 *
 * Pipeline (each step is a pure, testable function):
 *
 *   RenderInput  (verified snapshots + staleSince, from src/ingest/renderer.ts)
 *        │  buildResultsView + BundleResolver  → resolves content keys to rows
 *        ▼
 *   ResultsView  (per-repo rows incl. no-data + 4-timestamp surface)
 *        │  applyPublicVisibility                → drops Tier-2-no-consent / Tier-3
 *        ▼                                          / Tier-1-under-embargo rows
 *   ResultsView (public)
 *        │  generateResultsFiles                 → { path → html } map
 *        ▼
 *   writeResultsSite                              → writes the map under site/
 *
 * The public filter is applied to the resolved view (not at resolve time) so a
 * future tailnet-internal generator (bead puxu.9) can reuse the SAME view +
 * skip the filter. That separation is the whole point of keeping the tier gate a
 * standalone function.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type RenderInput } from '../ingest/renderer.js';
import { type BundleResolver } from './row-model.js';
import {
  buildResultsView,
  type RepoResults,
  type ResultsRow,
  type ResultsView,
} from './row-model.js';
import { filterPubliclyVisible } from './visibility.js';
import {
  bundleUrl,
  renderBundlePage,
  renderRepoPage,
  renderResultsIndex,
  repoUrl,
} from './render-html.js';

/**
 * Apply the PUBLIC visibility-tier filter to a built view.
 *
 * For each repo, drop every row that `filterPubliclyVisible` excludes (Tier-2
 * without consent, Tier-3, Tier-1 still under embargo). A repo whose rows all
 * get filtered out flips to `noData: true` — so a repo that exists only of
 * not-yet-public rows renders as a loud no-data state, NEVER as a partial pass.
 */
export function applyPublicVisibility(view: ResultsView, nowIso: string): ResultsView {
  const repos: RepoResults[] = view.repos.map((repo) => {
    const visibleRows = filterPubliclyVisible(repo.rows, nowIso);
    return {
      ...repo,
      rows: visibleRows,
      noData: visibleRows.length === 0,
    };
  });
  return { ...view, repos };
}

/**
 * Build the full public results view from raw render input.
 *
 * Convenience composition: resolve → build view → apply public visibility.
 */
export async function buildPublicResultsView(
  input: RenderInput,
  resolver: BundleResolver,
  nowIso: string,
): Promise<ResultsView> {
  const view = await buildResultsView(input, resolver);
  return applyPublicVisibility(view, nowIso);
}

/** A generated file: repo-relative path under `site/` → HTML content. */
export interface GeneratedFile {
  /** Path relative to the site root, e.g. `results/index.html`. */
  readonly path: string;
  readonly html: string;
}

/**
 * Generate every `/results/` HTML file from a (already public-filtered) view.
 *
 * Emits:
 *   - `results/index.html`               — the index with freshness strip + as-of
 *   - `results/<repo>/index.html`        — per-repo page (one per repo in view)
 *   - `results/<repo>/<bundle>/index.html` — per-bundle deep-link page
 *
 * Returns the file map WITHOUT touching disk so tests can assert structure +
 * the C3 scanner can run against the strings.
 */
export function generateResultsFiles(view: ResultsView): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  // Index.
  files.push({ path: 'results/index.html', html: renderResultsIndex(view) });

  // Per-repo + per-bundle.
  for (const repo of view.repos) {
    files.push({
      path: pathFromUrl(repoUrl(repo.repo)),
      html: renderRepoPage(view, repo),
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
        path: pathFromUrl(bundleUrl(repo.repo, bundleKey)),
        html: renderBundlePage(repo.repo, bundleKey, rows),
      });
    }
  }

  return files;
}

/** Turn a site URL like `/results/iec/` into a file path `results/iec/index.html`. */
export function pathFromUrl(url: string): string {
  const trimmed = url.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${trimmed}/index.html`;
}

/**
 * Write the generated files under `siteRoot`. Creates parent dirs as needed.
 * Returns the absolute paths written.
 */
export async function writeResultsSite(
  files: readonly GeneratedFile[],
  siteRoot: string,
): Promise<string[]> {
  const written: string[] = [];
  for (const file of files) {
    const abs = join(siteRoot, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.html, 'utf8');
    written.push(abs);
  }
  return written;
}
