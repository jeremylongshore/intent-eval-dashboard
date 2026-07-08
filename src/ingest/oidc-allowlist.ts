/**
 * Step 2 — OIDC issuer + subject + workflow_ref allowlist check.
 *
 * REAL claim comparison against the pinned per-repo allowlist
 * (`ingest/pinned-subjects.json`). This is the first gate after the manifest is
 * fetched: a wrong issuer, subject, or workflow_ref crashes the worker before
 * any cryptographic work happens.
 *
 * Match semantics:
 *   - issuer       — exact string equality.
 *   - subject      — exact, OR prefix match when the allowlist entry ends in a
 *                    single `*` (the release-tag family form
 *                    `repo:OWNER/REPO:ref:refs/tags/*`).
 *   - workflowRef  — same exact-or-trailing-`*`-prefix semantics.
 *
 * The trailing-`*` is a deliberately narrow glob (prefix only, one star at the
 * end) — NOT a general regex — so the allowlist cannot be tricked into matching
 * an attacker-controlled middle segment.
 */

import { type ManifestSigningClaims } from './manifest.js';

/** Per-repo allowlist entry. */
export interface PinnedRepoEntry {
  readonly githubRepo: string;
  readonly subjects: readonly string[];
  readonly workflowRefs: readonly string[];
  readonly operatorConfirmed: boolean;
  /**
   * Optional fixed Release tag for manifest resolution. When set, the manifest
   * URL resolver fetches from `releases/download/<manifestTag>/` instead of
   * `releases/latest/download/` — needed where `releases/latest` is polluted
   * by unrelated releases (e.g. ccp's per-package npm releases).
   */
  readonly manifestTag?: string;
}

/** The whole pinned allowlist document. */
export interface PinnedSubjects {
  readonly issuer: string;
  readonly repos: Readonly<Record<string, PinnedRepoEntry>>;
}

/** Result of a step-2 check. */
export type OidcCheckResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'repo_not_in_allowlist'
        | 'oidc_issuer_mismatch'
        | 'oidc_subject_mismatch'
        | 'oidc_workflow_ref_mismatch';
      readonly detail: string;
    };

/**
 * Exact-or-trailing-`*`-prefix match.
 *
 * A pattern is a literal unless it ends with exactly one `*`, in which case the
 * value must start with everything before the `*`. Any other `*` is treated
 * literally (so a pattern can't smuggle a mid-string wildcard).
 */
export function matchesPinnedPattern(pattern: string, value: string): boolean {
  if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return pattern === value;
}

/**
 * Verify a manifest's asserted OIDC claims for `repo` against the allowlist.
 *
 * Pure function — no I/O. The caller loads `pinned-subjects.json` once and
 * passes it in.
 */
export function checkOidcAllowlist(
  pinned: PinnedSubjects,
  repo: string,
  claims: ManifestSigningClaims,
): OidcCheckResult {
  const entry = pinned.repos[repo];
  if (entry === undefined) {
    return {
      ok: false,
      code: 'repo_not_in_allowlist',
      detail: `repo "${repo}" is not in the pinned allowlist`,
    };
  }

  if (claims.issuer !== pinned.issuer) {
    return {
      ok: false,
      code: 'oidc_issuer_mismatch',
      detail: `issuer "${claims.issuer}" != pinned "${pinned.issuer}"`,
    };
  }

  if (!entry.subjects.some((p) => matchesPinnedPattern(p, claims.subject))) {
    return {
      ok: false,
      code: 'oidc_subject_mismatch',
      detail: `subject "${claims.subject}" matched no pinned pattern for "${repo}"`,
    };
  }

  if (!entry.workflowRefs.some((p) => matchesPinnedPattern(p, claims.workflowRef))) {
    return {
      ok: false,
      code: 'oidc_workflow_ref_mismatch',
      detail: `workflow_ref "${claims.workflowRef}" matched no pinned pattern for "${repo}"`,
    };
  }

  return { ok: true };
}
