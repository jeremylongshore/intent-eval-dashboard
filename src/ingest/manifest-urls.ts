/**
 * Production manifest-URL resolver (step-1 wiring for the ingest worker).
 *
 * Maps each pinned source repo to the URL its CI publishes `report-manifest.json`
 * at. Derived from the SAME `pinned-subjects.json` allowlist the OIDC check uses
 * (single source of truth) — so a repo can only resolve to a URL if it is also
 * an allowlisted ingest source.
 *
 * Publication convention: every source repo's release workflow uploads
 * `report-manifest.json` as a GitHub Release asset, so the stable
 * `releases/latest/download/<asset>` URL always serves the newest release's
 * signed manifest. `iec` (intent-eval-core) resolves to the manifest emitted by
 * its `release.yml` emit-evidence job (bead nr75.4) — currently the v0.3.0
 * release asset.
 *
 * This is the resolver passed to {@link HttpManifestFetcher} when the production
 * ingest pass runs (the run itself is the human-gated / cron VPS step — this
 * module only wires WHERE to fetch, not WHEN).
 */

import { type ManifestUrlResolver } from './fetcher-http.js';
import { type PinnedSubjects } from './oidc-allowlist.js';

/** The Release-asset filename every source repo's CI publishes. */
export const REPORT_MANIFEST_ASSET = 'report-manifest.json' as const;

/** Build the `releases/latest` manifest URL for a `owner/repo` GitHub slug. */
export function manifestUrlForGithubRepo(githubRepo: string): string {
  return `https://github.com/${githubRepo}/releases/latest/download/${REPORT_MANIFEST_ASSET}`;
}

/**
 * Build the production {@link ManifestUrlResolver} from the pinned allowlist.
 *
 * Fail-closed: a repo that is not in the pinned-subjects allowlist throws rather
 * than resolving to a guessed URL — the resolver only serves verified sources.
 */
export function makeManifestUrlResolver(pinned: PinnedSubjects): ManifestUrlResolver {
  return (repo: string): string => {
    const entry = pinned.repos[repo];
    if (entry === undefined) {
      throw new Error(
        `manifest URL: repo "${repo}" is not in the pinned-subjects allowlist — refusing to resolve`,
      );
    }
    return manifestUrlForGithubRepo(entry.githubRepo);
  };
}
