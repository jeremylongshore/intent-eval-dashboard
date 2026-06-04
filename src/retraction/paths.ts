/**
 * Deterministic path derivation shared by the snippet + tombstone generators.
 *
 * Both the Caddy snippet (which rewrites the retracted deep URL to the tombstone
 * file) and the tombstone generator (which WRITES that file) must agree on
 * exactly one location per retracted deep URL. Keeping the derivation in one
 * pure function guarantees they never drift.
 *
 * Tombstones live under `site/retracted/<slug>/index.html`. They are
 * public-honest disclosure pages (Sigstore can't be un-logged — we disclose the
 * retraction rather than pretend it never happened), so serving them from the
 * public `site/` origin is correct. The `retracted/` prefix keeps them outside
 * the `results/` tree so they cannot be mistaken for live results.
 */

/** Slugify a deep URL path into a single stable filesystem/URL fragment. */
export function deepUrlSlug(deepUrlPath: string): string {
  return (
    deepUrlPath
      .toLowerCase()
      .replace(/^\/+|\/+$/g, '') // trim leading/trailing slashes
      .replace(/[^a-z0-9]+/g, '-') // collapse any non-alphanumeric run to one dash
      .replace(/^-+|-+$/g, '') || // trim dashes
    'root'
  ); // a retracted site root collapses to a stable slug
}

/**
 * The PUBLIC URL path at which the tombstone is served, e.g.
 * `/retracted/results-iec-0190.../`. This is the canonical link for the
 * disclosure page (the tombstone references its own retracted deep URL in the
 * body, not this path).
 */
export function tombstoneUrl(deepUrlPath: string): string {
  return `/retracted/${deepUrlSlug(deepUrlPath)}/`;
}

/**
 * The site-root-relative FILE path the tombstone is written to + that the Caddy
 * `rewrite` targets, e.g. `/retracted/results-iec-0190.../index.html`. Leading
 * slash so it is a valid Caddy `rewrite` target.
 */
export function tombstoneSitePath(deepUrlPath: string): string {
  return `${tombstoneUrl(deepUrlPath)}index.html`;
}

/**
 * The repo-relative path (under the `site/` root) the generator writes to, e.g.
 * `retracted/results-iec-0190.../index.html`. No leading slash — it is joined to
 * the site root directory.
 */
export function tombstoneRepoPath(deepUrlPath: string): string {
  return `retracted/${deepUrlSlug(deepUrlPath)}/index.html`;
}
