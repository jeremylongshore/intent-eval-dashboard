/**
 * Loader for `ingest/pinned-subjects.json`.
 *
 * Reads + structurally validates the pinned OIDC allowlist used by step 2.
 * Kept separate from `oidc-allowlist.ts` (pure logic) so the pure check stays
 * I/O-free and testable with inline fixtures.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { type PinnedRepoEntry, type PinnedSubjects } from './oidc-allowlist.js';

/** Default path: `<repo>/ingest/pinned-subjects.json`. */
export function defaultPinnedSubjectsPath(): string {
  // src/ingest/pinned-loader.ts → repo root is two dirs up from src/ingest.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'ingest', 'pinned-subjects.json');
}

/** Parse + validate a pinned-subjects document from an already-parsed value. */
export function parsePinnedSubjects(value: unknown): PinnedSubjects {
  if (typeof value !== 'object' || value === null) {
    throw new Error('pinned-subjects: not an object');
  }
  const v = value as Record<string, unknown>;
  if (typeof v['issuer'] !== 'string') {
    throw new Error('pinned-subjects: missing string "issuer"');
  }
  const reposRaw = v['repos'];
  if (typeof reposRaw !== 'object' || reposRaw === null) {
    throw new Error('pinned-subjects: missing "repos" object');
  }
  const repos: Record<string, PinnedRepoEntry> = {};
  for (const [repo, entryRaw] of Object.entries(reposRaw as Record<string, unknown>)) {
    if (typeof entryRaw !== 'object' || entryRaw === null) {
      throw new Error(`pinned-subjects: repo "${repo}" entry is not an object`);
    }
    const e = entryRaw as Record<string, unknown>;
    if (typeof e['githubRepo'] !== 'string') {
      throw new Error(`pinned-subjects: repo "${repo}" missing "githubRepo"`);
    }
    if (!isStringArray(e['subjects'])) {
      throw new Error(`pinned-subjects: repo "${repo}" "subjects" must be string[]`);
    }
    if (!isStringArray(e['workflowRefs'])) {
      throw new Error(`pinned-subjects: repo "${repo}" "workflowRefs" must be string[]`);
    }
    const manifestTag = e['manifestTag'];
    if (
      manifestTag !== undefined &&
      (typeof manifestTag !== 'string' || manifestTag.trim() === '')
    ) {
      throw new Error(`pinned-subjects: repo "${repo}" "manifestTag" must be a non-empty string`);
    }
    repos[repo] = {
      githubRepo: e['githubRepo'],
      subjects: e['subjects'],
      workflowRefs: e['workflowRefs'],
      operatorConfirmed: e['operatorConfirmed'] === true,
      ...(manifestTag !== undefined ? { manifestTag } : {}),
    };
  }
  return { issuer: v['issuer'], repos };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === 'string');
}

/** Load + parse the pinned allowlist from disk. */
export async function loadPinnedSubjects(
  path: string = defaultPinnedSubjectsPath(),
): Promise<PinnedSubjects> {
  const text = await readFile(path, 'utf8');
  return parsePinnedSubjects(JSON.parse(text));
}

/**
 * A pin is only as good as its own consistency: every `subjects` entry must
 * name `githubRepo` (`repo:<githubRepo>:...`) and every `workflowRefs` entry
 * must start with `<githubRepo>/`. When a source repository is renamed on
 * GitHub the OIDC subject in every new certificate changes with it, and a pin
 * that still names the old slug rejects every manifest as
 * `oidc_subject_mismatch` — quietly, per repo, while the renderer keeps serving
 * the last-known-good snapshot with a stale badge. That is exactly what
 * happened to the marketplace source (`ccp`) from 2026-08-26 to 2026-09-06
 * after `claude-code-plugins-plus-skills` became `tons-of-skills-marketplace`.
 *
 * Returns one human-readable issue per inconsistency; empty means consistent.
 * Kept as a pure function so tests can prove it catches the mutant, and so the
 * ingest can log it without turning one bad pin into an outage for every repo.
 */
export function pinConsistencyIssues(doc: PinnedSubjects): string[] {
  const issues: string[] = [];
  for (const [key, e] of Object.entries(doc.repos)) {
    for (const s of e.subjects) {
      if (!s.startsWith(`repo:${e.githubRepo}:`)) {
        issues.push(`${key}: subject "${s}" does not name githubRepo "${e.githubRepo}"`);
      }
    }
    for (const w of e.workflowRefs) {
      if (!w.startsWith(`${e.githubRepo}/`)) {
        issues.push(`${key}: workflowRef "${w}" does not start with githubRepo "${e.githubRepo}/"`);
      }
    }
  }
  return issues;
}
