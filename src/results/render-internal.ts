/**
 * HTML rendering for the TAILNET-ONLY operator-internal results view (puxu.9).
 *
 * This is the INVERSE of the public `/results/` browser (`render-html.ts`): it
 * renders EVERY row regardless of visibility tier — Tier-1 (incl. under
 * embargo), Tier-2 (incl. no-consent), and Tier-3 ALL appear — so an operator
 * on the tailnet sees the complete picture, including the rows the public site
 * deliberately hides. To make the *reason* a row is or isn't public legible,
 * each row carries a visibility-tier badge derived from the SAME
 * `decidePublicVisibility` rule the public generator applies.
 *
 * ── HARD SEPARATION (the whole point of puxu.9) ──
 *
 * This output is written to `site-internal/` — NEVER `site/`. The public Caddy
 * block serves `site/`; a future, human-gated, Tailscale-identity-gated Caddy
 * block will serve `site-internal/`. Nothing here is ever served from the
 * public origin. The pages are explicitly `noindex, nofollow` and carry no
 * public `canonical` so that even if one leaked it would not be indexed.
 *
 * ── Reuse, not reinvention ──
 *
 * The 4-timestamp surface, deep-link addressing, decision badges, per-predicate
 * breakdown, no-data panel, and as-of banner are the EXACT same helpers the
 * public browser uses (imported from `render-html.ts`) — so the operator view is
 * a faithful superset, not a divergent re-implementation. The only additions are
 * the visibility-tier column + the operator banner + the USE-method view on the
 * index (imported from `freshness/render-strip.ts`).
 *
 * ── C3 SAFETY (preserved even though we show MORE) ──
 *
 * Showing every tier does NOT relax the C3 binding (DR-035 § 4): we still render
 * decision counts ONLY within a single predicate URI (reused
 * `perPredicateBreakdown`), never a composited `X/N pass` / `X% pass` across
 * heterogeneous predicates. The visibility-tier badges ("tier: 2 — no-consent")
 * are plain prose and contain no aggregate-pass token. So `site-internal/`
 * output is structurally as C3-clean as `site/`.
 */

import { type IngestUseView } from '../freshness/use-model.js';
import { renderUseCards } from '../freshness/render-strip.js';
import {
  asOfBanner,
  decisionBadge,
  esc,
  noDataPanel,
  perPredicateBreakdown,
  SITE_FOOTER,
} from './render-html.js';
import { type RepoResults, type ResultsRow, type ResultsView } from './row-model.js';
import { decidePublicVisibility, type PublicExclusionReason } from './visibility.js';

/** The internal-view URL prefix (kept distinct from the public `/results/`). */
const INTERNAL_PREFIX = '/internal/results';

/** Internal per-repo URL (lives under `/internal/results/` on the tailnet host). */
export function internalRepoUrl(repo: string): string {
  return `${INTERNAL_PREFIX}/${slugLocal(repo)}/`;
}

/** Internal per-bundle deep-link URL (content-key-addressed, like the public one). */
export function internalBundleUrl(repo: string, bundleKey: string): string {
  return `${INTERNAL_PREFIX}/${slugLocal(repo)}/${slugLocal(bundleKey)}/`;
}

/** Local slug (identical rule to render-html's `slug`, kept private to avoid coupling). */
function slugLocal(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Internal-view document head — `noindex, nofollow`, NO public canonical, and a
 * `iep-view` marker so the page self-identifies as the operator surface. Mirrors
 * the public head's structure (charset, viewport, stylesheet) so it reuses the
 * same `/style.css` and passes the same DOCTYPE/closing-tag/stylesheet sanity
 * shape, but it is deliberately NOT discoverable.
 */
const INTERNAL_HEAD = (title: string, description: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/style.css">

    <meta name="iep-view" content="operator-internal">
    <meta name="iep-surface" content="tailnet-only">
    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
</head>`;

/** Internal site header — labelled OPERATOR so it can never be mistaken for public. */
const INTERNAL_HEADER = `    <header class="site-header site-header--internal">
        <div class="site-header__inner">
            <a href="${INTERNAL_PREFIX}/" class="site-header__wordmark">IEP&nbsp;Labs · <span class="badge badge--internal">OPERATOR</span></a>
            <nav class="site-nav" aria-label="Primary">
                <a href="${INTERNAL_PREFIX}/">Internal results</a>
                <a href="/results/">Public results</a>
                <a href="/status/">Status</a>
                <a href="https://github.com/jeremylongshore/intent-eval-dashboard">GitHub</a>
            </nav>
        </div>
    </header>`;

/**
 * The loud "this is the operator-internal, tailnet-only view" banner. Rendered
 * at the top of every internal page so an operator (or anyone who somehow lands
 * here) immediately understands this surface shows rows the public site hides.
 */
const OPERATOR_BANNER = `        <div class="operator-banner">
            <p style="margin:0;"><strong>Operator-internal view (tailnet-only).</strong> This surface renders <em>every</em> verified gate-result row regardless of visibility tier — including Tier-2 rows without consent, Tier-3 case-by-case rows, and Tier-1 rows still under embargo. It is the <em>inverse</em> of the <a href="/results/">public results browser</a>, which omits all of those. This output lives at <code>site-internal/</code> and is served only behind Tailscale identity on the tailnet — it must never be wired into the public origin.</p>
        </div>`;

/** Human label + CSS modifier for a public-exclusion reason. */
function reasonLabel(reason: PublicExclusionReason): { label: string; mod: string } {
  switch (reason) {
    case 'tier-2-no-consent':
      return { label: 'tier 2 — internal-only (no consent)', mod: 'tier-2' };
    case 'tier-3-case-by-case':
      return { label: 'tier 3 — case-by-case (GC review)', mod: 'tier-3' };
    case 'tier-1-under-embargo':
      return { label: 'tier 1 — under embargo', mod: 'tier-1-embargo' };
    case 'unknown-tier':
      return { label: 'unknown tier — fail-closed', mod: 'unknown' };
  }
}

/**
 * The visibility-tier badge for ONE row — the operator-context column. It shows
 * WHY a row is / is not on the public site, computed from the SAME
 * `decidePublicVisibility` rule the public generator applies, so the operator
 * never has to guess. Pure prose, no aggregate-pass token (C3-safe).
 */
export function visibilityBadge(row: ResultsRow, nowIso: string): string {
  const decision = decidePublicVisibility(row.visibility, nowIso);
  if (decision.public) {
    return `<span class="vis-badge vis-badge--public" title="this row is also publicly visible">tier ${esc(tierNum(row))} — public</span>`;
  }
  const { label, mod } = reasonLabel(decision.reason);
  return `<span class="vis-badge vis-badge--internal vis-badge--${esc(mod)}" title="hidden from the public site; shown here for operators">${esc(label)} — internal-only</span>`;
}

/** Extract the numeric tier ('1'|'2'|'3') from a row's visibility for the badge. */
function tierNum(row: ResultsRow): string {
  return row.visibility.tier.replace('tier-', '');
}

/**
 * The internal results table for one repo — same 4-timestamp surface as the
 * public table PLUS a leading Visibility column showing each row's tier + the
 * public/internal-only reason. Deep links point at the INTERNAL bundle URL.
 */
function internalResultsTable(rows: readonly ResultsRow[], nowIso: string): string {
  const trs = rows
    .map((row) => {
      const rekor =
        row.rekorLogIndices.length > 0
          ? row.rekorLogIndices
              .map(
                (i) =>
                  `<a href="https://rekor.sigstore.dev/api/v1/log/entries?logIndex=${i}"><code>${i}</code></a>`,
              )
              .join(', ')
          : '<code>—</code>';
      return `                <tr>
                    <td>${visibilityBadge(row, nowIso)}</td>
                    <td><a href="${esc(internalBundleUrl(row.repo, row.bundleKey))}"><code>${esc(row.gateName)}</code></a></td>
                    <td>${decisionBadge(row.decision)}</td>
                    <td><code>${esc(row.predicateUri)}</code></td>
                    <td><time datetime="${esc(row.evaluatedAt)}">${esc(row.evaluatedAt)}</time></td>
                    <td><time datetime="${esc(row.bundleCreatedAt)}">${esc(row.bundleCreatedAt)}</time></td>
                    <td>${rekor}</td>
                    <td><time datetime="${esc(row.ingestedAt)}">${esc(row.ingestedAt)}</time></td>
                </tr>`;
    })
    .join('\n');
  return `        <table class="results-table results-table--internal">
            <thead>
                <tr>
                    <th>Visibility</th>
                    <th>Gate</th>
                    <th>Decision</th>
                    <th>Predicate URI</th>
                    <th>Evaluated at</th>
                    <th>Bundle created at</th>
                    <th>Rekor anchor</th>
                    <th>Ingested at</th>
                </tr>
            </thead>
            <tbody>
${trs}
            </tbody>
        </table>`;
}

/** One repo's body: no-data panel OR per-predicate breakdown + internal table. */
function repoBody(repo: RepoResults, nowIso: string): string {
  if (repo.noData) return noDataPanel(repo.repo);
  return perPredicateBreakdown(repo.rows) + '\n' + internalResultsTable(repo.rows, nowIso);
}

/**
 * Render the internal results INDEX page.
 *
 * Carries: the operator banner, the global as-of banner (reused), the
 * USE-method view of the ingest pipeline (reused from freshness), and a section
 * per repo with the visibility-annotated internal table.
 */
export function renderInternalIndex(view: ResultsView, use: IngestUseView, nowIso: string): string {
  const title = 'Operator-internal results — Intent Eval Platform (tailnet-only)';
  const description =
    'Operator-internal results view: every verified gate-result row regardless of visibility tier. Tailnet-only, never served from the public origin.';
  const repoSections = view.repos
    .map((r) => {
      const stale =
        r.staleSince !== undefined
          ? ` <span class="badge badge--stale">stale since ${esc(r.staleSince)}</span>`
          : '';
      const link = !r.noData
        ? `\n        <p><a href="${esc(internalRepoUrl(r.repo))}">All internal results for ${esc(r.repo)} →</a></p>`
        : '';
      return `        <section class="repo-results">
            <h3><a href="${esc(internalRepoUrl(r.repo))}"><code>${esc(r.repo)}</code></a>${stale}</h3>
${repoBody(r, nowIso)}${link}
        </section>`;
    })
    .join('\n');

  return `${INTERNAL_HEAD(title, description)}
<body>
${INTERNAL_HEADER}
    <main>
        <h1>Operator-internal results</h1>
${OPERATOR_BANNER}
        <p class="lead">
            Every row below traces back through a content-addressed Evidence Bundle — signed via sigstore, anchored in the Rekor transparency log, re-verified at ingest — to a <code>gate-result/v1</code> attestation. Unlike the <a href="/results/">public browser</a>, this view applies <strong>no visibility filter</strong>: each row is annotated with its tier and whether it is also public.
        </p>
        <p>
            Decision counts are still shown <em>per predicate URI only</em> — we never composite a pass-rate across heterogeneous predicates, even internally. <code>no-data</code> is not a pass.
        </p>
${asOfBanner(view)}
        <h2>Ingest pipeline status (USE method)</h2>
        <p>System health of the 6-worker ingest pipeline itself — the same USE-method view the public <a href="/status/">/status</a> page carries.</p>
${renderUseCards(use)}
        <h2>Per-repo results (all tiers)</h2>
${repoSections}
    </main>
${SITE_FOOTER}`;
}

/** Render one repo's internal `/internal/results/<repo>/` page. */
export function renderInternalRepoPage(
  view: ResultsView,
  repo: RepoResults,
  nowIso: string,
): string {
  const title = `Operator-internal results: ${repo.repo} — Intent Eval Platform`;
  const description = `Operator-internal results for ${repo.repo} — all tiers, tailnet-only.`;
  const stale =
    repo.staleSince !== undefined
      ? ` <span class="badge badge--stale">stale since ${esc(repo.staleSince)}</span>`
      : '';
  return `${INTERNAL_HEAD(title, description)}
<body>
${INTERNAL_HEADER}
    <main>
        <p><a href="${INTERNAL_PREFIX}/">← All internal results</a></p>
        <h1>Operator-internal: <code>${esc(repo.repo)}</code>${stale}</h1>
${OPERATOR_BANNER}
${asOfBanner(view)}
${repoBody(repo, nowIso)}
    </main>
${SITE_FOOTER}`;
}

/** Render one bundle's internal `/internal/results/<repo>/<bundleKey>/` deep-link page. */
export function renderInternalBundlePage(
  repo: string,
  bundleKey: string,
  rows: readonly ResultsRow[],
  nowIso: string,
): string {
  const title = `Operator-internal bundle ${bundleKey} — Intent Eval Platform`;
  const description = `Operator-internal gate-result rows for content-addressed bundle ${bundleKey}.`;
  const body =
    rows.length === 0
      ? noDataPanel(repo)
      : perPredicateBreakdown(rows) + '\n' + internalResultsTable(rows, nowIso);
  return `${INTERNAL_HEAD(title, description)}
<body>
${INTERNAL_HEADER}
    <main>
        <p><a href="${esc(internalRepoUrl(repo))}">← ${esc(repo)} internal results</a></p>
        <h1>Bundle</h1>
${OPERATOR_BANNER}
        <div class="meta-block">
            <dl>
                <dt>repo</dt><dd><code>${esc(repo)}</code></dd>
                <dt>content key</dt><dd><code>${esc(bundleKey)}</code></dd>
            </dl>
            <p style="margin-top:0.75rem;margin-bottom:0;">This deep link is addressed by the bundle's content hash, not a git SHA — it survives an upstream force-push or branch deletion.</p>
        </div>
${body}
    </main>
${SITE_FOOTER}`;
}
