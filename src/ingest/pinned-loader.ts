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
