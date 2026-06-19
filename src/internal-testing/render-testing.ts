/**
 * HTML rendering for the GATED internal testing dashboard (Pillar 1, bead nr75.1).
 *
 * This is the operator/learning face of the platform: per-repo testing results
 * (coverage / mutation / CRAP / architecture / escape-scan, all carried as
 * `gate-result/v1`) rendered NOT as a CSV but as a guided tour. For every gate
 * it shows, in order:
 *
 *   1. the authored explainer — *what this is, how we run it, what good looks like*
 *   2. the verified data — decision + the 4-timestamp surface + Rekor anchor
 *   3. the auto verdict — ✓ good / ! watch / ✗ fail / ⚠ error, in plain English
 *   4. what we measured — the coverage declaration (evaluated vs skipped dims)
 *   5. what to fix — the row's own `gate_reasons[]`, verbatim
 *
 * ── SURFACE: gated, not public, not tailnet-only ──
 *
 * Output goes under `site-internal/internal/testing/` and is served behind Caddy
 * **basicauth** at `internal.intentsolutions.io` (see the design DR +
 * `040-AT-DECR` successor-DR addendum, which records the acting-head override of
 * DR-035 § 8's "tailnet-only operator view" refusal for this NEW named surface,
 * under CISO's 5 lift-overs). Pages are `noindex, nofollow` with no public
 * canonical so a leaked URL is never indexed. The pre-existing tailnet-only
 * operator-RESULTS view (`src/results/render-internal.ts`) is a DIFFERENT surface
 * and is unchanged.
 *
 * ── C3 SAFETY ──
 *
 * Every row here carries the SAME predicate URI (`gate-result/v1`), and the page
 * renders no `X/N pass` / `X% pass` token at all — only per-row verdicts and
 * per-repo row counts. So the output is structurally C3-clean (DR-035 § 4); the
 * `lint:c3:internal` gate scans it exactly like the public site.
 */

import { esc, decisionBadge, noDataPanel, SITE_FOOTER } from '../results/render-html.js';
import { type ExplainerSet, explainerFor, INDEX_EXPLAINER_KEY } from './explainers.js';
import {
  type CoverageDecl,
  type TestingRepo,
  type TestingRow,
  type TestingView,
} from './testing-row.js';
import { deriveVerdict, type Verdict, type VerdictKind, VERDICT_WEIGHT } from './verdict.js';

/** URL prefix for the gated testing dashboard. */
const TESTING_PREFIX = '/internal/testing';

/** Per-repo testing page URL. */
export function testingRepoUrl(repo: string): string {
  return `${TESTING_PREFIX}/${slugLocal(repo)}/`;
}

/** Local slug (same rule as the results lane, kept private to avoid coupling). */
function slugLocal(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Map an internal testing URL to its file path under the internal site root. */
export function pathFromTestingUrl(url: string): string {
  const trimmed = url.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${trimmed}/index.html`;
}

/**
 * Document head for the gated surface — `noindex, nofollow`, NO public canonical,
 * and a `iep-surface=basicauth-gated` marker so the page self-identifies as the
 * gated testing dashboard (distinct from the tailnet-only operator-results view).
 */
const GATED_HEAD = (title: string, description: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="noindex, nofollow">
    <link rel="stylesheet" href="/style.css">

    <meta name="iep-view" content="internal-testing">
    <meta name="iep-surface" content="basicauth-gated">
    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
</head>`;

/** Site header — labelled TESTING so it can never be mistaken for the public site. */
const GATED_HEADER = `    <header class="site-header site-header--internal">
        <div class="site-header__inner">
            <a href="${TESTING_PREFIX}/" class="site-header__wordmark">IEP&nbsp;Labs · <span class="badge badge--internal">TESTING</span></a>
            <nav class="site-nav" aria-label="Primary">
                <a href="${TESTING_PREFIX}/">Testing dashboard</a>
                <a href="/results/">Public results</a>
                <a href="/status/">Status</a>
                <a href="https://github.com/jeremylongshore/intent-eval-dashboard">GitHub</a>
            </nav>
        </div>
    </header>`;

/** The "this surface is gated, here is what it shows" banner. */
const GATED_BANNER = `        <div class="operator-banner">
            <p style="margin:0;"><strong>Internal testing dashboard (gated).</strong> This surface renders our own testing results — coverage, mutation, CRAP, architecture, and escape-scan gates — for every platform repo, each one <em>taught</em>: what the gate is, how we run it, what good looks like, our number, the verdict, and exactly what to fix. Every row traces back to a signed, Rekor-anchored <code>gate-result/v1</code> attestation re-verified at ingest. It is served behind a password at <code>internal.intentsolutions.io</code>; it is never indexed and never part of the public site.</p>
        </div>`;

/** The verdict badge (accessible: decorative glyph + visible label). */
export function verdictBadge(verdict: Verdict): string {
  return `<span class="verdict verdict--${esc(verdict.kind)}"><span aria-hidden="true">${esc(verdict.glyph)}</span> ${esc(verdict.label)}</span>`;
}

/** Worst verdict kind across a set of rows (for sort + repo summary). */
function worstVerdictKind(rows: readonly TestingRow[]): VerdictKind {
  let worst: VerdictKind = 'good';
  for (const row of rows) {
    const k = deriveVerdict(row).kind;
    if (VERDICT_WEIGHT[k] < VERDICT_WEIGHT[worst]) worst = k;
  }
  return worst;
}

/** Render the coverage "what we measured" block. */
function coverageBlock(coverage: CoverageDecl): string {
  const evaluated =
    coverage.dimensionsEvaluated.length > 0
      ? coverage.dimensionsEvaluated.map((d) => `<code>${esc(d)}</code>`).join(', ')
      : '<em>none declared</em>';
  const skipped =
    coverage.dimensionsSkipped.length > 0
      ? `<p class="measured__skipped"><strong>Not measured (skipped):</strong> ${coverage.dimensionsSkipped
          .map((d) => `<code>${esc(d)}</code>`)
          .join(', ')} — a skipped dimension is not a passed one.</p>`
      : '';
  return `                <div class="measured">
                    <p><strong>What we measured:</strong> ${evaluated}</p>
${skipped}                </div>`;
}

/** Render the "what to fix" list (verbatim gate_reasons). */
function whatToFixBlock(verdict: Verdict): string {
  if (verdict.whatToFix.length === 0) {
    return `                <p class="what-to-fix what-to-fix--none">Nothing to fix — this gate is passing.</p>`;
  }
  const items = verdict.whatToFix
    .map((r) => `                        <li>${esc(r)}</li>`)
    .join('\n');
  return `                <div class="what-to-fix">
                    <p><strong>What to fix:</strong></p>
                    <ul>
${items}
                    </ul>
                </div>`;
}

/**
 * The Rekor anchor cell (links each log index to the public transparency log).
 *
 * Defence in depth: although `i` is typed `number`, the production resolver is
 * deferred and a JSON-deserialised value could slip a non-integer through the
 * type hole. We only build the URL from a validated non-negative integer (else
 * the link is inert `#`), and the visible text is always escaped — so a bad
 * value can never break out of the `href` attribute or the `<code>` text.
 */
function rekorAnchors(indices: readonly number[]): string {
  if (indices.length === 0) return '<code>—</code>';
  return indices
    .map((i) => {
      const safe = Number.isInteger(i) && i >= 0 ? String(i) : '';
      const href =
        safe.length > 0 ? `https://rekor.sigstore.dev/api/v1/log/entries?logIndex=${safe}` : '#';
      return `<a href="${esc(href)}"><code>${esc(String(i))}</code></a>`;
    })
    .join(', ');
}

/** Render ONE gate-result row as a verdict card (data + verdict + measured + fix). */
function rowCard(row: TestingRow): string {
  const verdict = deriveVerdict(row);
  return `            <div class="gate-row gate-row--${esc(verdict.kind)}">
                <p class="gate-row__verdict">${verdictBadge(verdict)} ${decisionBadge(row.decision)} <span class="gate-row__headline">${esc(verdict.headline)}</span></p>
                <dl class="gate-row__meta">
                    <dt>gate version</dt><dd><code>${esc(row.gateVersion)}</code></dd>
                    <dt>predicate URI</dt><dd><code>${esc(row.predicateUri)}</code></dd>
                    <dt>evaluated at</dt><dd><time datetime="${esc(row.evaluatedAt)}">${esc(row.evaluatedAt)}</time></dd>
                    <dt>bundle created at</dt><dd><time datetime="${esc(row.bundleCreatedAt)}">${esc(row.bundleCreatedAt)}</time></dd>
                    <dt>Rekor anchor</dt><dd>${rekorAnchors(row.rekorLogIndices)}</dd>
                    <dt>ingested at</dt><dd><time datetime="${esc(row.ingestedAt)}">${esc(row.ingestedAt)}</time></dd>
                </dl>
${coverageBlock(row.coverage)}
${whatToFixBlock(verdict)}
            </div>`;
}

/** Group a repo's rows by gate name, sorted worst-verdict-first then by name. */
function groupByGate(rows: readonly TestingRow[]): { gateName: string; rows: TestingRow[] }[] {
  const byGate = new Map<string, TestingRow[]>();
  for (const row of rows) {
    const existing = byGate.get(row.gateName);
    if (existing === undefined) byGate.set(row.gateName, [row]);
    else existing.push(row);
  }
  const groups = [...byGate.entries()].map(([gateName, gateRows]) => ({
    gateName,
    rows: [...gateRows].sort(
      (a, b) => VERDICT_WEIGHT[deriveVerdict(a).kind] - VERDICT_WEIGHT[deriveVerdict(b).kind],
    ),
  }));
  groups.sort((a, b) => {
    const wa = VERDICT_WEIGHT[worstVerdictKind(a.rows)];
    const wb = VERDICT_WEIGHT[worstVerdictKind(b.rows)];
    if (wa !== wb) return wa - wb;
    return a.gateName.localeCompare(b.gateName);
  });
  return groups;
}

/** Render one gate group: the authored explainer once, then each row's card. */
function gateGroupSection(
  gateName: string,
  rows: readonly TestingRow[],
  explainers: ExplainerSet,
): string {
  const doc = explainerFor(explainers, gateName);
  const explainerHtml =
    doc !== undefined
      ? `            <div class="gate-explainer">
${doc.html}
            </div>`
      : `            <p class="gate-explainer gate-explainer--missing"><em>No explainer authored yet for this gate.</em></p>`;
  const cards = rows.map(rowCard).join('\n');
  return `        <section class="gate-block">
            <h2><code>${esc(gateName)}</code></h2>
${explainerHtml}
${cards}
        </section>`;
}

/** A small as-of banner (decoupled from the results-lane ResultsView type). */
function asOfBanner(asOf: string | undefined): string {
  if (asOf === undefined) {
    return `        <div class="meta-block as-of as-of--none">
            <p style="margin:0;"><strong>As of:</strong> no source has a verified snapshot yet. Every repo below is in a <code>no-data</code> state.</p>
        </div>`;
  }
  return `        <div class="meta-block as-of">
            <p style="margin:0;"><strong>As of:</strong> <time datetime="${esc(asOf)}">${esc(asOf)}</time> — the oldest ingest across all sources in this view (<code>min(ingested_at)</code>).</p>
        </div>`;
}

/** Render the per-repo testing page. */
export function renderTestingRepoPage(
  view: TestingView,
  repo: TestingRepo,
  explainers: ExplainerSet,
): string {
  const title = `Testing: ${repo.repo} — Intent Eval Platform (internal)`;
  const description = `Internal testing dashboard for ${repo.repo} — coverage, mutation, CRAP, architecture, escape-scan, taught.`;
  const stale =
    repo.staleSince !== undefined
      ? ` <span class="badge badge--stale">stale since ${esc(repo.staleSince)}</span>`
      : '';
  const body = repo.noData
    ? noDataPanel(repo.repo)
    : groupByGate(repo.rows)
        .map((g) => gateGroupSection(g.gateName, g.rows, explainers))
        .join('\n');
  return `${GATED_HEAD(title, description)}
<body>
${GATED_HEADER}
    <main>
        <p><a href="${TESTING_PREFIX}/">← All repos</a></p>
        <h1>Testing: <code>${esc(repo.repo)}</code>${stale}</h1>
${GATED_BANNER}
${asOfBanner(view.asOf)}
${body}
    </main>
${SITE_FOOTER}`;
}

/** Render the per-repo summary row on the index. */
function repoSummaryRow(repo: TestingRepo): string {
  const status = repo.noData
    ? `<span class="badge badge--no-data">no-data</span>`
    : `<span class="badge badge--fresh">${repo.rows.length} gate-result row${repo.rows.length === 1 ? '' : 's'}</span>`;
  const verdict = repo.noData
    ? '<code>—</code>'
    : verdictBadge(deriveVerdict(repo.rows[worstVerdictIndex(repo.rows)]!));
  const stale =
    repo.staleSince !== undefined
      ? ` <span class="badge badge--stale">stale since ${esc(repo.staleSince)}</span>`
      : '';
  return `                <tr>
                    <td><a href="${esc(testingRepoUrl(repo.repo))}"><code>${esc(repo.repo)}</code></a></td>
                    <td>${status}${stale}</td>
                    <td>${verdict}</td>
                </tr>`;
}

/** Index of the worst-verdict row in a non-empty repo (caller guards noData). */
function worstVerdictIndex(rows: readonly TestingRow[]): number {
  let idx = 0;
  let worst = VERDICT_WEIGHT[deriveVerdict(rows[0]!).kind];
  for (let i = 1; i < rows.length; i++) {
    const w = VERDICT_WEIGHT[deriveVerdict(rows[i]!).kind];
    if (w < worst) {
      worst = w;
      idx = i;
    }
  }
  return idx;
}

/** Render the testing-dashboard index ("how to read this" + per-repo summary). */
export function renderTestingIndex(view: TestingView, explainers: ExplainerSet): string {
  const title = 'Internal testing dashboard — Intent Eval Platform';
  const description =
    'Gated internal testing dashboard: per-repo coverage, mutation, CRAP, architecture, and escape-scan gates from signed gate-result/v1 attestations, each one taught.';
  const howTo = explainers.get(INDEX_EXPLAINER_KEY);
  const howToHtml =
    howTo !== undefined
      ? `        <section class="how-to-read">
${howTo.html}
        </section>`
      : '';
  const summaryRows = view.repos.map(repoSummaryRow).join('\n');
  return `${GATED_HEAD(title, description)}
<body>
${GATED_HEADER}
    <main>
        <h1>Internal testing dashboard</h1>
${GATED_BANNER}
${howToHtml}
${asOfBanner(view.asOf)}
        <h2>Per-repo testing results</h2>
        <table class="freshness-strip">
            <thead>
                <tr><th>Repo</th><th>Status</th><th>Worst verdict</th></tr>
            </thead>
            <tbody>
${summaryRows}
            </tbody>
        </table>
    </main>
${SITE_FOOTER}`;
}
