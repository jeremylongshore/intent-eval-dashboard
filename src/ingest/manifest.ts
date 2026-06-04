/**
 * `report-manifest.json` shape — the document a source repo's CI publishes and
 * the ingest worker fetches (step 1).
 *
 * The manifest enumerates the signed Evidence Bundle rows produced by one CI
 * run. Each row carries:
 *   - the bundle payload (the JSON the kernel schema validates, step 5);
 *   - a sigstore bundle (DSSE envelope + cert chain + Rekor inclusion proof)
 *     that steps 3 + 4 verify;
 *   - the source SHA the bundle was produced at (recorded for provenance — the
 *     deep link survives a later force-push because step 6 content-addresses
 *     the bundle by sha256, NOT by source SHA).
 *
 * `signing` carries the OIDC claims the CI run asserts (issuer, subject,
 * workflow_ref). Step 2 verifies these against the pinned allowlist AND step
 * 3/4 cryptographically bind them to the signing certificate (defense in depth).
 */

/** OIDC identity claims asserted by the source CI run. */
export interface ManifestSigningClaims {
  /** OIDC issuer, e.g. `https://token.actions.githubusercontent.com`. */
  readonly issuer: string;
  /** OIDC subject, e.g. `repo:jeremylongshore/intent-eval-core:ref:refs/tags/v0.2.0`. */
  readonly subject: string;
  /** Reusable-workflow ref, e.g. `.../release.yml@refs/tags/v0.2.0`. */
  readonly workflowRef: string;
}

/** One row in a report manifest. */
export interface ManifestRow {
  /**
   * The Evidence Bundle payload object (kernel-schema-validated at step 5).
   * Kept as `unknown` here — the worker parses it through the kernel's Zod
   * validator rather than trusting a local type.
   */
  readonly bundle: unknown;
  /**
   * The sigstore Bundle (serialized JSON) attesting to `bundle`. Verified at
   * steps 3 (Rekor inclusion) + 4 (DSSE signature). `unknown` because the
   * sigstore verifier owns its parsing/validation.
   */
  readonly sigstoreBundle: unknown;
  /** Source git SHA the bundle was produced at (provenance only). */
  readonly sourceSha: string;
}

/** A fetched + parsed report manifest. */
export interface ReportManifest {
  /** Repo key (one of the 6 ingest repos). */
  readonly repo: string;
  /** OIDC claims asserted by the producing CI run. */
  readonly signing: ManifestSigningClaims;
  /** The signed Evidence Bundle rows. */
  readonly rows: readonly ManifestRow[];
}

/** Minimal structural validation of a fetched manifest payload. */
export function isReportManifestShape(value: unknown): value is ReportManifest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['repo'] !== 'string') return false;
  const signing = v['signing'];
  if (typeof signing !== 'object' || signing === null) return false;
  const s = signing as Record<string, unknown>;
  if (typeof s['issuer'] !== 'string') return false;
  if (typeof s['subject'] !== 'string') return false;
  if (typeof s['workflowRef'] !== 'string') return false;
  if (!Array.isArray(v['rows'])) return false;
  return v['rows'].every((r) => {
    if (typeof r !== 'object' || r === null) return false;
    const row = r as Record<string, unknown>;
    return 'bundle' in row && 'sigstoreBundle' in row && typeof row['sourceSha'] === 'string';
  });
}
