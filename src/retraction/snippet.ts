/**
 * Caddy `retractions.snippet` generator (bead puxu.10).
 *
 * Produces the CONTENT of the file that would live at
 * `/etc/caddy/retractions.snippet` and is `import`ed into the
 * `labs.intentsolutions.io` Caddy block. For each retracted deep URL it emits a
 * `handle` block that returns **410 Gone** and serves the tombstone page body.
 *
 * Why 410 (not 404, not 301): 410 Gone is the honest HTTP status — the resource
 * existed and was intentionally removed, and clients/crawlers should drop it.
 * 404 would imply "never existed" (a lie — it is in the transparency log); a 301
 * would imply "moved" (also false). The tombstone body discloses WHY.
 *
 * Caddy form (verified against Caddy v2 file_server `status` subdirective):
 *
 *   handle /results/iec/<key>/ /results/iec/<key> {
 *       root * {$IEP_SITE_ROOT}
 *       rewrite * /retracted/results-iec-<key>/index.html
 *       header X-IEP-Retraction-Reason "<reason_class>"
 *       file_server {
 *           status 410
 *       }
 *   }
 *
 * `file_server`'s `status 410` subdirective serves the rewritten tombstone FILE
 * as the response body while overriding the status to 410 — the one directive
 * that gives us "honest 410 + disclosure body" in a single, version-portable
 * block. `root` is parameterized via the `{$IEP_SITE_ROOT}` Caddy env so the
 * snippet is host-path agnostic (the VPS block sets it once).
 *
 * NO Hugo / NO site rebuild (GC binding, DR-035 § 8): this is a flat text file
 * generated from `retractions.json`. The retraction takes effect via
 * `git commit + rsync + caddy validate + systemctl reload caddy` — there is NO
 * build step in the retraction path. The tombstone HTML it points at is also
 * generated here (served from `site/`), already on disk; Caddy just routes to
 * it.
 *
 * This generator WRITES A FILE to a repo path (e.g. `deploy/retractions.snippet`)
 * — it does NOT touch the VPS. rsync to `/etc/caddy/`, `caddy validate`, and
 * `systemctl reload caddy` (NEVER restart) are the human-gated VPS step.
 */

import { type RetractionDenylist, type RetractionEntry } from './denylist.js';
import { tombstoneSitePath } from './paths.js';

/**
 * Caddy escaping for a double-quoted token: backslash + double quote. The
 * deep_url_path / tombstone path are already restricted to a safe charset by the
 * denylist schema (no spaces/quotes), but we escape defensively for any value
 * templated into a quoted Caddy token.
 */
function caddyQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Sanitize a value for safe inclusion in a single-line Caddy `#` comment. */
function caddyComment(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Build the Caddy path matcher token(s) for an exact deep URL. We match both the
 * trailing-slash and non-slash forms so a deep link 410s either way.
 */
function pathMatchers(path: string): string {
  if (path.endsWith('/')) {
    const noSlash = path.replace(/\/+$/, '');
    return noSlash === '' ? path : `${path} ${noSlash}`;
  }
  return `${path} ${path}/`;
}

/**
 * Render the `handle` block for one retracted deep URL: match the path, rewrite
 * to the tombstone file, tag a response header, and serve it with a 410 status.
 */
function handleBlockFor(entry: RetractionEntry): string {
  const matchers = pathMatchers(entry.deep_url_path);
  const tombstone = tombstoneSitePath(entry.deep_url_path);
  return `\t# retracted ${caddyComment(entry.retracted_at)} — reason_class=${entry.reason_class}
\thandle ${matchers} {
\t\troot * {$IEP_SITE_ROOT}
\t\trewrite * ${caddyQuote(tombstone)}
\t\theader X-IEP-Retraction-Reason "${caddyQuote(entry.reason_class)}"
\t\tfile_server {
\t\t\tstatus 410
\t\t}
\t}`;
}

/** The generated-file header — explains provenance + the no-rebuild contract. */
const SNIPPET_HEADER = `# retractions.snippet — GENERATED from retractions.json. DO NOT EDIT BY HAND.
#
# Regenerate: pnpm run generate:retractions
# Source:     src/retraction/denylist.ts (validated) -> src/retraction/snippet.ts
#
# Deploy (human-gated VPS step — NOT performed by this repo's automation):
#   1. git commit the regenerated snippet + tombstones
#   2. rsync this file to /etc/caddy/retractions.snippet on the VPS
#   3. caddy validate   (NEVER skip)
#   4. systemctl reload caddy   (reload — NEVER restart; 24 prod containers)
#
# The labs site block must set the site root env once and import this file:
#   {$IEP_SITE_ROOT} = /srv/intent-eval-dashboard/site
#   import retractions.snippet
#
# Each block returns 410 Gone and serves the tombstone body. 410 (not 404) is
# the honest status: the resource existed and was intentionally withdrawn. The
# original attestation remains in the Rekor transparency log; the tombstone
# discloses the reason_class. (retraction-protocol binding, DR-035.)
`;

/**
 * Generate the full `retractions.snippet` content from a validated denylist.
 *
 * An EMPTY denylist yields a valid no-op snippet (header + an explicit
 * "no retractions" comment, zero `handle` blocks) — importing it is harmless.
 */
export function renderSnippet(denylist: RetractionDenylist): string {
  if (denylist.length === 0) {
    return `${SNIPPET_HEADER}\n# (no retractions — this snippet is a no-op)\n`;
  }
  const blocks = denylist.map(handleBlockFor).join('\n\n');
  return `${SNIPPET_HEADER}\n${blocks}\n`;
}
