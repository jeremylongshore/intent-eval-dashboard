/**
 * Retraction generator — denylist -> Caddy snippet + tombstone pages.
 *
 * The orchestration step of the retraction protocol (bead puxu.10): read the
 * validated `retractions.json` denylist, derive the Caddy `retractions.snippet`
 * (one 410 `handle` block per retracted deep URL) AND a public tombstone HTML
 * page per retraction, and return them as in-memory file maps. Writing them to
 * disk + the VPS deploy are separate steps (writing is local; deploy is the
 * human-gated rsync + caddy reload).
 *
 *   retractions.json  (validated by src/retraction/denylist.ts)
 *        │  renderSnippet     -> Caddy 410 directives (deploy/retractions.snippet)
 *        │  renderTombstone   -> one disclosure HTML per entry (site/retracted/…)
 *        ▼
 *   { snippet, tombstones[] }
 *
 * NO Hugo / NO site rebuild (GC binding): every output is a flat file. The
 * tombstones are plain self-contained HTML; the snippet is a Caddy text file.
 * The retraction takes effect via git commit + rsync + caddy reload — never a
 * build.
 *
 * Pure functions are kept separate from the IO so tests assert the generated
 * STRINGS deterministically and the synthetic end-to-end test runs in-process.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  validateDenylist,
  type RetractionDenylist,
  type DenylistValidationIssue,
} from './denylist.js';
import { renderSnippet } from './snippet.js';
import { renderTombstone } from './tombstone.js';
import { tombstoneRepoPath } from './paths.js';

/** A generated file: repo-relative path -> content. */
export interface GeneratedRetractionFile {
  readonly path: string;
  readonly content: string;
}

/** The full output of a retraction generation run. */
export interface RetractionArtifacts {
  /** The Caddy snippet content (one entry; goes to deploy/retractions.snippet). */
  readonly snippet: GeneratedRetractionFile;
  /** One tombstone HTML file per retraction (goes under site/retracted/). */
  readonly tombstones: readonly GeneratedRetractionFile[];
}

/** Where the generated artifacts are written (relative to the repo root). */
export interface RetractionOutputPaths {
  /** Caddy snippet output path. Default `deploy/retractions.snippet`. */
  readonly snippetPath: string;
  /** Site root the tombstones are written under. Default `site`. */
  readonly siteRoot: string;
}

/** Default output locations. */
export const DEFAULT_OUTPUT: RetractionOutputPaths = {
  snippetPath: 'deploy/retractions.snippet',
  siteRoot: 'site',
};

/**
 * Build the snippet + tombstone artifacts from a VALIDATED denylist. Pure — no
 * IO. An empty denylist yields a no-op snippet + zero tombstones.
 */
export function buildArtifacts(
  denylist: RetractionDenylist,
  output: RetractionOutputPaths = DEFAULT_OUTPUT,
): RetractionArtifacts {
  const snippet: GeneratedRetractionFile = {
    path: output.snippetPath,
    content: renderSnippet(denylist),
  };
  const tombstones: GeneratedRetractionFile[] = denylist.map((entry) => ({
    path: join(output.siteRoot, tombstoneRepoPath(entry.deep_url_path)),
    content: renderTombstone(entry),
  }));
  return { snippet, tombstones };
}

/** Raised when `retractions.json` fails validation — fail closed, never partial. */
export class DenylistInvalidError extends Error {
  constructor(public readonly issues: readonly DenylistValidationIssue[]) {
    super(
      `retractions.json failed validation:\n` +
        issues.map((i) => `  [entry ${i.index}] ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'DenylistInvalidError';
  }
}

/**
 * Read + validate `retractions.json` from disk. Returns the validated denylist.
 * A MISSING file is treated as an empty denylist (no retractions yet) — a valid,
 * fully-functional state. A PRESENT-but-INVALID file throws
 * {@link DenylistInvalidError} (fail closed — never silently skip a bad entry).
 */
export async function loadDenylist(jsonPath: string): Promise<RetractionDenylist> {
  let raw: string;
  try {
    raw = await readFile(jsonPath, 'utf8');
  } catch {
    // Missing file => no retractions yet. Valid.
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new DenylistInvalidError([
      {
        index: -1,
        path: '(file)',
        message: `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    ]);
  }
  const result = validateDenylist(parsed);
  if (!result.ok) {
    throw new DenylistInvalidError(result.issues);
  }
  return result.denylist;
}

/** Write the generated artifacts to disk, creating parent dirs. Returns paths written. */
export async function writeArtifacts(artifacts: RetractionArtifacts): Promise<string[]> {
  const written: string[] = [];
  for (const file of [artifacts.snippet, ...artifacts.tombstones]) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
    written.push(file.path);
  }
  return written;
}

/**
 * Full generation: load + validate `retractions.json`, build artifacts, write
 * them. Returns the artifacts + the paths written. The VPS deploy (rsync +
 * caddy validate + reload) is NOT performed here.
 */
export async function generateRetractions(
  jsonPath: string,
  output: RetractionOutputPaths = DEFAULT_OUTPUT,
): Promise<{ artifacts: RetractionArtifacts; written: string[] }> {
  const denylist = await loadDenylist(jsonPath);
  const artifacts = buildArtifacts(denylist, output);
  const written = await writeArtifacts(artifacts);
  return { artifacts, written };
}
