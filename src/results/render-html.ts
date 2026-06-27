/**
 * HTML rendering for the public `/results/` browser.
 *
 * Renders the verified results view into self-contained HTML pages matching the
 * existing labs.intentsolutions.io single-file pattern (shared `/style.css`, no
 * JS, DOCTYPE + closing `</html>` + stylesheet link so the deploy.yml HTML
 * sanity gate passes).
 *
 * Hard bindings enforced HERE (in addition to the C3 lint that scans output):
 *
 *   - **No cross-predicate aggregate PASS%.** Counts are rendered ONLY within a
 *     single predicate URI group, and even then as an explicit per-decision
 *     breakdown (`pass: N · fail: M · …`), never as a composited `X/N pass` or
 *     `X% pass`. The renderer literally has no code path that sums decisions
 *     across predicate URIs. (CTO + CMO + VP DevRel triple-refusal, C3.)
 *   - **`no-data` carries equal visual weight with `fail`.** A repo with no
 *     verified rows renders a loud `no-data` panel (red-tinted badge, same
 *     prominence as a failure) — never a neutral/pass-looking blank. (CMO C4.)
 *   - **Visible `stale_since` badge per source** when serving a prior-good
 *     snapshot. (Gregg + Armstrong.)
 *   - **4-timestamp surface per row** — evaluated_at + bundle created_at + Rekor
 *     anchor + ingested_at, never collapsed. (Gregg.)
 *   - **Global as-of banner** = min(ingested_at across the view). (Gregg.)
 *   - **No predicate URI declared under labs.*** — predicate URIs are only ever
 *     RENDERED (as data the row attests against), pointed at evals.* ; the page
 *     never declares one at labs.* (CISO.)
 */

import { type RepoResults, type ResultsRow, type ResultsView } from './row-model.js';

/** HTML-escape a string for safe text/attribute interpolation. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Slugify a repo key / predicate URI into a stable URL fragment. */
export function slug(value: string): string {
  return trimDashes(value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
}

/**
 * Trim leading/trailing `-` from an already-collapsed slug. Uses string scans
 * (not a `/-+$/`-style regex) so it is provably linear — avoids the polynomial
 * ReDoS that CodeQL `js/polynomial-redos` flags on the anchored-quantifier form.
 */
export function trimDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 45 /* '-' */) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 45 /* '-' */) end -= 1;
  return value.slice(start, end);
}

/** Stable per-repo results URL. */
export function repoUrl(repo: string): string {
  return `/results/${slug(repo)}/`;
}

/** Stable per-bundle deep-link URL (content-key-addressed, survives force-push). */
export function bundleUrl(repo: string, bundleKey: string): string {
  return `/results/${slug(repo)}/${slug(bundleKey)}/`;
}

const PAGE_HEAD = (
  title: string,
  description: string,
  canonical: string,
): string => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://labs.intentsolutions.io${esc(canonical)}">
    <link rel="stylesheet" href="/style.css">

    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="https://labs.intentsolutions.io${esc(canonical)}">
    <meta property="og:type" content="website">

    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
</head>`;

export const SITE_HEADER = `    <header class="site-header">
        <div class="site-header__inner">
            <a href="/" class="site-header__wordmark">IEP&nbsp;Labs</a>
            <nav class="site-nav" aria-label="Primary">
                <a href="/eval-sets/">Eval Sets</a>
                <a href="/results/">Results</a>
                <a href="/skills/">Skills</a>
                <a href="/methodology/">Methodology</a>
                <a href="https://github.com/jeremylongshore/intent-eval-dashboard">GitHub</a>
            </nav>
        </div>
    </header>`;

export const SITE_FOOTER = `    <footer class="site-footer">
        <div class="site-footer__inner">
            <div>
                <strong>labs.intentsolutions.io</strong> · dashboard <code>v0.1.0</code> · <a href="/status/" class="footer__commitment">best-effort, single-operator, see /status for liveness</a><br>
                Intent Solutions — <a href="https://intentsolutions.io">intentsolutions.io</a>
            </div>
            <div>
                <a href="/methodology/">Methodology</a> ·
                <a href="/eval-sets/">Eval Sets</a> ·
                <a href="/results/">Results</a> ·
                <a href="/skills/">Skills</a> ·
                <a href="/status/">Status</a> ·
                <a href="https://github.com/jeremylongshore/intent-eval-dashboard">GitHub</a>
            </div>
        </div>
    </footer>
</body>
</html>
`;

/** Decision → badge CSS modifier. `no-data` shares the loud fail-equal style. */
export function decisionBadge(decision: string): string {
  return `<span class="badge badge--result-${esc(decision)}">${esc(decision)}</span>`;
}

/** The global "as-of" banner (min ingested_at). */
export function asOfBanner(view: ResultsView): string {
  if (view.asOf === undefined) {
    return `        <div class="meta-block as-of as-of--none">
            <p style="margin:0;"><strong>As of:</strong> no source has a verified snapshot yet. Every repo below is in a <code>no-data</code> state.</p>
        </div>`;
  }
  return `        <div class="meta-block as-of">
            <p style="margin:0;"><strong>As of:</strong> <time datetime="${esc(view.asOf)}">${esc(view.asOf)}</time> — the oldest ingest across all sources in this view (<code>min(ingested_at)</code>). Sources verified more recently may be fresher.</p>
        </div>`;
}

/**
 * The per-repo freshness strip rendered at the top of every results view.
 * One row per source repo. `no-data` and stale are visually loud.
 */
function freshnessStrip(view: ResultsView): string {
  const rows = view.repos
    .map((r) => {
      const stale =
        r.staleSince !== undefined
          ? ` <span class="badge badge--stale" title="serving prior-good snapshot">stale since ${esc(r.staleSince)}</span>`
          : '';
      const status = r.noData
        ? `<span class="badge badge--no-data">no-data</span>`
        : `<span class="badge badge--fresh">${r.rows.length} row${r.rows.length === 1 ? '' : 's'}</span>`;
      const ingested =
        r.ingestedAt !== undefined ? `<code>${esc(r.ingestedAt)}</code>` : `<code>—</code>`;
      return `                <tr>
                    <td><a href="${esc(repoUrl(r.repo))}"><code>${esc(r.repo)}</code></a></td>
                    <td>${status}${stale}</td>
                    <td>${ingested}</td>
                </tr>`;
    })
    .join('\n');
  return `        <h2>Per-repo freshness</h2>
        <table class="freshness-strip">
            <thead>
                <tr><th>Source</th><th>Status</th><th>Last ingested</th></tr>
            </thead>
            <tbody>
${rows}
            </tbody>
        </table>`;
}

/**
 * Per-single-predicate-URI decision breakdown for ONE repo.
 *
 * C3-SAFE: counts are computed and rendered strictly WITHIN one predicate URI.
 * There is no aggregation across predicate URIs anywhere in this function, and
 * the rendered text is an explicit per-decision breakdown — never `X/N pass` or
 * `X% pass`.
 */
export function perPredicateBreakdown(rows: readonly ResultsRow[]): string {
  // Group by predicate URI. Each group is rendered independently.
  const byPredicate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let counts = byPredicate.get(row.predicateUri);
    if (counts === undefined) {
      counts = new Map<string, number>();
      byPredicate.set(row.predicateUri, counts);
    }
    counts.set(row.decision, (counts.get(row.decision) ?? 0) + 1);
  }
  const groups = [...byPredicate.entries()].map(([uri, counts]) => {
    // Explicit per-decision breakdown within this ONE predicate. The word
    // "pass" only ever appears as a labelled per-decision count, never as a
    // composited fraction/percent that the C3 scanner forbids.
    const order = ['pass', 'fail', 'advisory', 'error'];
    const parts = order
      .filter((d) => (counts.get(d) ?? 0) > 0)
      .map((d) => `${esc(d)}: ${counts.get(d) ?? 0}`)
      .join(' · ');
    return `            <li><code>${esc(uri)}</code> — ${parts}</li>`;
  });
  return `        <p class="predicate-note">Decision counts are shown <em>per predicate URI</em> only. We never composite a pass-rate across heterogeneous predicates — that is metric laundering.</p>
        <ul class="predicate-breakdown">
${groups.join('\n')}
        </ul>`;
}

/** Render one results row as a table row (with deep link + 4-timestamp surface). */
function rowTr(row: ResultsRow): string {
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
                    <td><a href="${esc(bundleUrl(row.repo, row.bundleKey))}"><code>${esc(row.gateName)}</code></a></td>
                    <td>${decisionBadge(row.decision)}</td>
                    <td><code>${esc(row.predicateUri)}</code></td>
                    <td><time datetime="${esc(row.evaluatedAt)}">${esc(row.evaluatedAt)}</time></td>
                    <td><time datetime="${esc(row.bundleCreatedAt)}">${esc(row.bundleCreatedAt)}</time></td>
                    <td>${rekor}</td>
                    <td><time datetime="${esc(row.ingestedAt)}">${esc(row.ingestedAt)}</time></td>
                </tr>`;
}

/** The loud no-data panel — equal visual weight with fail (CMO C4). */
export function noDataPanel(repo: string): string {
  return `        <div class="no-data-panel">
            <p class="no-data-panel__title"><span class="badge badge--no-data">no-data</span> No verified results for <code>${esc(repo)}</code></p>
            <p>This source has not yet published a verified, signed Evidence Bundle to this dashboard. <strong>No data is not a pass.</strong> It is rendered with the same prominence as a failure so an empty source can never be mistaken for a clean one.</p>
        </div>`;
}

/** The 4-timestamp results table for one repo (header + rows). */
function resultsTable(rows: readonly ResultsRow[]): string {
  return `        <table class="results-table">
            <thead>
                <tr>
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
${rows.map(rowTr).join('\n')}
            </tbody>
        </table>`;
}

/** Render the `/results/` index page. */
export function renderResultsIndex(view: ResultsView): string {
  const title = 'Results — Intent Eval Platform';
  const description =
    'Verified gate-result rows from the Intent Eval Platform repos, rendered from signed, Rekor-anchored Evidence Bundles. No aggregate pass-rates across predicates.';
  const repoSections = view.repos
    .map((r) => {
      const stale =
        r.staleSince !== undefined
          ? ` <span class="badge badge--stale">stale since ${esc(r.staleSince)}</span>`
          : '';
      const body = r.noData
        ? noDataPanel(r.repo)
        : perPredicateBreakdown(r.rows) +
          '\n' +
          resultsTable(r.rows) +
          `\n        <p><a href="${esc(repoUrl(r.repo))}">All results for ${esc(r.repo)} →</a></p>`;
      return `        <section class="repo-results">
            <h3><a href="${esc(repoUrl(r.repo))}"><code>${esc(r.repo)}</code></a>${stale}</h3>
${body}
        </section>`;
    })
    .join('\n');

  return `${PAGE_HEAD(title, description, '/results/')}
<body>
${SITE_HEADER}
    <main>
        <h1>Results</h1>
        <p class="lead">
            Each row below traces back through a content-addressed Evidence Bundle — signed via sigstore, anchored in the Rekor transparency log, re-verified at ingest — to a <code>gate-result/v1</code> attestation. We render the spec of what we measure on the <a href="/eval-sets/">eval-sets</a> page; here we render <em>what happened</em>.
        </p>
        <p>
            We do not publish an aggregate "PASS%" across heterogeneous predicates. <code>no-data</code> is not a pass; <code>advisory</code> is not a pass. Counts are only ever shown within a single predicate URI.
        </p>
${asOfBanner(view)}
${freshnessStrip(view)}
        <h2>Per-repo results</h2>
${repoSections}
    </main>
${SITE_FOOTER}`;
}

/** Render one repo's `/results/<repo>/` page. */
export function renderRepoPage(view: ResultsView, repo: RepoResults): string {
  const title = `Results: ${repo.repo} — Intent Eval Platform`;
  const description = `Verified gate-result rows for ${repo.repo}, from signed Evidence Bundles.`;
  const stale =
    repo.staleSince !== undefined
      ? ` <span class="badge badge--stale">stale since ${esc(repo.staleSince)}</span>`
      : '';
  const body = repo.noData
    ? noDataPanel(repo.repo)
    : perPredicateBreakdown(repo.rows) + '\n' + resultsTable(repo.rows);
  return `${PAGE_HEAD(title, description, repoUrl(repo.repo))}
<body>
${SITE_HEADER}
    <main>
        <p><a href="/results/">← All results</a></p>
        <h1>Results: <code>${esc(repo.repo)}</code>${stale}</h1>
${asOfBanner(view)}
${body}
    </main>
${SITE_FOOTER}`;
}

/** Render one bundle's `/results/<repo>/<bundleKey>/` deep-link page. */
export function renderBundlePage(
  repo: string,
  bundleKey: string,
  rows: readonly ResultsRow[],
): string {
  const title = `Bundle ${bundleKey} — Intent Eval Platform`;
  const description = `Verified gate-result rows for content-addressed bundle ${bundleKey}.`;
  const body =
    rows.length === 0 ? noDataPanel(repo) : perPredicateBreakdown(rows) + '\n' + resultsTable(rows);
  return `${PAGE_HEAD(title, description, bundleUrl(repo, bundleKey))}
<body>
${SITE_HEADER}
    <main>
        <p><a href="${esc(repoUrl(repo))}">← ${esc(repo)} results</a></p>
        <h1>Bundle</h1>
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
