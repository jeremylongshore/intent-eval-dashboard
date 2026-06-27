/**
 * Per-skill signals generator — the data → site step for `/skills/`.
 *
 * The wave-2 sibling of `src/results/generate.ts`. It builds the per-skill view
 * from a {@link SkillSignalResolver} (which returns ONLY verified kernel
 * entities — verify-before-render is preserved through the seam) and emits the
 * self-contained HTML pages under `site/skills/`.
 *
 * Pipeline (each step is a pure, testable function):
 *
 *   skill names + SkillSignalResolver
 *        │  buildSkillsView   → resolves each skill's verified UsageEvent /
 *        ▼                       HumanReview rows into a per-dimension SkillCard
 *   SkillsView  (per-skill cards incl. loud per-dimension no-data)
 *        │  generateSkillsFiles → { path → html } map
 *        ▼
 *   writeSkillsSite           → writes the map under site/
 *
 * C3 is enforced STRUCTURALLY upstream (the view-model has no aggregate field)
 * AND by the same `lint:c3` scanner the results browser uses, run over the
 * emitted `site/skills/` HTML.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildSkillsView,
  type SkillSignalResolver,
  type SkillsView,
} from './skill-signal-model.js';
import { renderSkillPage, renderSkillsIndex, skillUrl } from './render-skills.js';

/** A generated file: repo-relative path under `site/` → HTML content. */
export interface GeneratedSkillFile {
  /** Path relative to the site root, e.g. `skills/index.html`. */
  readonly path: string;
  readonly html: string;
}

/**
 * Generate every `/skills/` HTML file from a built view.
 *
 * Emits:
 *   - `skills/index.html`           — the index with every skill card
 *   - `skills/<skill>/index.html`   — per-skill page (one per skill in view)
 *
 * Returns the file map WITHOUT touching disk so tests can assert structure + the
 * C3 scanner can run against the strings.
 */
export function generateSkillsFiles(view: SkillsView): GeneratedSkillFile[] {
  const files: GeneratedSkillFile[] = [];
  files.push({ path: 'skills/index.html', html: renderSkillsIndex(view) });
  for (const card of view.skills) {
    files.push({ path: pathFromUrl(skillUrl(card.skill)), html: renderSkillPage(card) });
  }
  return files;
}

/** Turn a site URL like `/skills/foo/` into a file path `skills/foo/index.html`. */
export function pathFromUrl(url: string): string {
  const trimmed = url.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${trimmed}/index.html`;
}

/**
 * Build the view then generate the files in one step.
 *
 * Convenience composition for the CLI entrypoint + tests.
 */
export async function buildSkillsFiles(
  skills: readonly string[],
  resolver: SkillSignalResolver,
): Promise<GeneratedSkillFile[]> {
  const view = await buildSkillsView(skills, resolver);
  return generateSkillsFiles(view);
}

/**
 * Write the generated files under `siteRoot`. Creates parent dirs as needed.
 * Returns the absolute paths written.
 */
export async function writeSkillsSite(
  files: readonly GeneratedSkillFile[],
  siteRoot: string,
): Promise<string[]> {
  // The files are independent (distinct paths, each with its own parent dir;
  // `mkdir … { recursive: true }` is idempotent so a shared parent is safe), so
  // there is no ordering reason to write them one at a time. Parallelize the
  // mkdir+write pairs and preserve the input order in the returned paths.
  return Promise.all(
    files.map(async (file) => {
      const abs = join(siteRoot, file.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.html, 'utf8');
      return abs;
    }),
  );
}
