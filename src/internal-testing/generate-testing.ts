/**
 * Internal testing-dashboard generator — the view → site step (bead nr75.1).
 *
 * Composes the verified {@link TestingView} with the authored {@link ExplainerSet}
 * into the gated testing pages, returning a path → HTML map (no disk touch) so
 * tests can assert structure and the C3 scanner can run over the strings.
 * {@link writeTestingSite} then writes that map under `site-internal/` —
 * NEVER the public `site/` origin (the separation is load-bearing, same as the
 * operator-results lane).
 *
 * Emits, under the `internal/testing/` URL space:
 *   - `internal/testing/index.html`           — "how to read this" + per-repo summary
 *   - `internal/testing/<repo>/index.html`    — per-repo guided tour
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type ExplainerSet } from './explainers.js';
import {
  pathFromTestingUrl,
  renderTestingIndex,
  renderTestingRepoPage,
  testingRepoUrl,
} from './render-testing.js';
import { type TestingView } from './testing-row.js';

/** A generated file: path under `site-internal/` → HTML content. */
export interface TestingGeneratedFile {
  /** Path relative to the internal site root, e.g. `internal/testing/index.html`. */
  readonly path: string;
  readonly html: string;
}

/**
 * Generate every gated testing-dashboard HTML file from a view + explainer set.
 *
 * The index is always emitted (even when every repo is no-data); a per-repo page
 * is emitted for every repo in the view.
 */
export function generateTestingFiles(
  view: TestingView,
  explainers: ExplainerSet,
): TestingGeneratedFile[] {
  const files: TestingGeneratedFile[] = [];

  files.push({
    path: 'internal/testing/index.html',
    html: renderTestingIndex(view, explainers),
  });

  for (const repo of view.repos) {
    files.push({
      path: pathFromTestingUrl(testingRepoUrl(repo.repo)),
      html: renderTestingRepoPage(view, repo, explainers),
    });
  }

  return files;
}

/**
 * Write the generated files under `internalSiteRoot` (e.g. `site-internal/`).
 * Creates parent dirs as needed. Returns the absolute paths written.
 *
 * IMPORTANT: `internalSiteRoot` must NEVER be `site/` (the public origin). The
 * CLI entrypoint enforces that; this function trusts its caller but the path
 * space (`internal/testing/...`) can never collide with the public `results/`
 * tree regardless.
 */
export async function writeTestingSite(
  files: readonly TestingGeneratedFile[],
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
