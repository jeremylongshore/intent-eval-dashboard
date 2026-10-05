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
 *     verified rows renders an explicit `no-data` panel (outlined unknown
 *     state, distinct from failure) — never a pass-looking blank. (CMO C4.)
 *   - **Visible `stale_since` badge per source** when serving a prior-good
 *     snapshot. (Gregg + Armstrong.)
 *   - **4-timestamp surface per row** — evaluated_at + bundle created_at + Rekor
 *     anchor + ingested_at, never collapsed. (Gregg.)
 *   - **Global as-of banner** = min(ingested_at across the view). (Gregg.)
 *   - **No predicate URI declared under labs.*** — predicate URIs are only ever
 *     RENDERED (as data the row attests against), pointed at evals.* ; the page
 *     never declares one at labs.* (CISO.)
 */

import { readFileSync } from 'node:fs';

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

/** Stable URL of the flat all-evals listing. */
export const ALL_EVALS_URL = '/evals/';

/**
 * Where each source repo keeps its versioned eval definitions on GitHub. A
 * signed `policy_ref` becomes a link only for a repo listed here; every other
 * repo renders it as plain text, so a link never points at a guessed location.
 */
const SPEC_SOURCE_REPOS: Readonly<Record<string, string>> = {
  jrig: 'jeremylongshore/tons-of-skills-marketplace',
};

/** `sha256:<policy hash>:<repo path>@<commit>`, the j-rig policy_ref shape. */
const POLICY_REF_RE = /^sha256:[a-f0-9]{64}:([A-Za-z0-9._/-]+)@([a-f0-9]{7,40})$/;

/**
 * GitHub URL of the exact eval definition a signed row ran, or null when the
 * repo has no known definition source or the policy_ref is not the expected
 * shape. The commit comes from the policy_ref itself; the row's full
 * `commit_sha` is used only when it extends that same commit.
 */
export function specUrl(repo: string, policyRef: string, commitSha?: string): string | null {
  const source = SPEC_SOURCE_REPOS[repo];
  if (source === undefined) return null;
  const m = POLICY_REF_RE.exec(policyRef);
  if (m === null) return null;
  const path = m[1] ?? '';
  const shortSha = m[2] ?? '';
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  const sha =
    commitSha !== undefined && /^[a-f0-9]{40}$/.test(commitSha) && commitSha.startsWith(shortSha)
      ? commitSha
      : shortSha;
  return `https://github.com/${source}/blob/${sha}/${path}`;
}

/** The eval-definition cell: a link when resolvable, the raw ref otherwise. */
function specCell(row: ResultsRow): string {
  if (row.policyRef === undefined) return '<code>—</code>';
  const url = specUrl(row.repo, row.policyRef, row.commitSha);
  return url === null
    ? `<code>${esc(row.policyRef)}</code>`
    : `<a href="${esc(url)}">eval spec</a>`;
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

/**
 * The top network strip shared by every Intent Solutions property. Its single
 * source is intent-solutions-landing/estate-bar, vendored here by
 * scripts/sync-estate-bar.sh. It is emitted verbatim: the estate bar test runs
 * the canonical checker over every public page, so a label, href or order that
 * differs from the canonical strip fails the suite.
 */
const ESTATE_BAR = readFileSync(
  new URL('../../vendor/estate-bar/fragments/estate-bar.labs.html', import.meta.url),
  'utf8',
)
  .trim()
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n');

export const SITE_HEADER = `<header class="site-header">
${ESTATE_BAR}
    <div class="site-header__inner">
      <a href="/" class="site-header__wordmark">Intent&nbsp;Labs</a>
      <nav class="site-nav" aria-label="Primary">
        <a href="/eval-sets/">What we test</a>
        <a href="/how-it-works/">How it works</a>
        <a href="/examples/">Examples</a>
        <a href="/start/">Start here</a>
      </nav>
    </div>
  </header>`;

export const SITE_FOOTER = `<footer class="site-footer"><div class="site-footer__inner">
    <div><strong>Intent Labs</strong><br>Part of <a href="https://intentsolutions.io/">Intent Solutions</a> · <a href="https://intentsolutions.io/about/#team">Our team</a></div>
    <div><a href="/results/">All results</a> · <a href="/evals/">All evals</a> · <a href="/methodology/">Technical guide</a> ·
      <a href="https://evals.intentsolutions.io/">Result definitions</a> · <a href="/skills/">Skill signals</a> ·
      <a href="/status/">Lab status</a><br>
      <a href="/status/" class="footer__commitment">best-effort, single-operator, see /status for liveness</a>
    </div>
  </div></footer>
</body>
</html>
`;

/** Decision → badge CSS modifier. Missing evidence has its own unknown style. */
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
  return `        <div class="table-scroll" role="region" aria-label="Detailed test results" tabindex="0"><table class="results-table">
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
        </table></div>`;
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
            Want one list of every eval with links? See <a href="/evals/">all evals</a>.
        </p>
        <p class="lead">
            These are the detailed records behind our published tests. Start with <a href="/examples/">a plain-language example</a> if you want to understand what a result means before inspecting the data.
        </p>
        <p>
            <strong>Pass</strong> means the tested requirements were met. <strong>Fail</strong> means a requirement was missed. <strong>Advisory</strong> needs attention; <strong>error</strong> means a check could not finish. <strong>No data</strong> means no verified result is available. None of these is a blanket approval of a system.
        </p>
        <p>
            Each record uses a versioned definition and a verified signed evidence bundle. Counts stay within one kind of test, never a blended score across different tests. <a href="/methodology/#evidence">How to read the technical evidence</a>.
        </p>
${asOfBanner(view)}
${freshnessStrip(view)}
        <h2>Results by project</h2>
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
    rows.length === 0
      ? noDataPanel(repo)
      : perPredicateBreakdown(rows) + '\n' + resultsTable(rows) + '\n' + rowDetails(rows);
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

/** Per-row "why" + eval definition, shown under a bundle's results table. */
function rowDetails(rows: readonly ResultsRow[]): string {
  const items = rows
    .filter((r) => (r.reasons !== undefined && r.reasons.length > 0) || r.policyRef !== undefined)
    .map((r) => {
      const reasons =
        r.reasons !== undefined && r.reasons.length > 0
          ? `\n                <ul>\n${r.reasons.map((x) => `                    <li>${esc(x)}</li>`).join('\n')}\n                </ul>`
          : '';
      return `            <section class="row-detail">
                <h3><code>${esc(r.gateName)}</code> ${decisionBadge(r.decision)}</h3>
                <p>Eval definition: ${specCell(r)}</p>${reasons}
            </section>`;
    });
  if (items.length === 0) return '';
  return `        <h2>Why</h2>
        <p>The reasons below are copied from the signed result, in the order the evaluator wrote them.</p>
${items.join('\n')}`;
}

/** Plain-English names for the source projects shown on `/evals/`. */
const PROJECT_NAMES: Readonly<Record<string, string>> = {
  iec: 'Contracts kernel',
  iel: 'Methodology lab',
  iah: 'Audit harness',
  iaj: 'J-Rig evaluator',
  iar: 'Rollout gate',
  ccp: 'Skills marketplace',
  jrig: 'AI skill tests',
  qmd: 'Team knowledge base',
};

/** A project's display name; an unknown key is shown as-is rather than guessed. */
export function projectName(repo: string): string {
  return PROJECT_NAMES[repo] ?? repo;
}

/** Repos whose rows are behavioral tests of AI skills (vs. code quality gates). */
const SKILL_TEST_REPOS: ReadonlySet<string> = new Set(['jrig']);

/** Word fixes for readable test names: acronyms and product spellings. */
const WORD_FIXES: Readonly<Record<string, string>> = {
  ai: 'AI',
  api: 'API',
  ci: 'CI',
  gpu: 'GPU',
  mcp: 'MCP',
  sql: 'SQL',
  uc: 'UC',
  skillmd: 'SKILL.md',
  coreweave: 'CoreWeave',
  databricks: 'Databricks',
  hubspot: 'HubSpot',
  supabase: 'Supabase',
  sentry: 'Sentry',
  gitleaks: 'Gitleaks',
  codeql: 'CodeQL',
};

/** `coreweave-gpu-cost-leak-hunter` -> `CoreWeave GPU cost leak hunter`. */
export function readableName(gateName: string): string {
  const words = gateName.split(/[-_]+/).filter((w) => w !== '');
  if (words.length === 0) return gateName;
  return words
    .map((w, i) => {
      const fixed = WORD_FIXES[w.toLowerCase()];
      if (fixed !== undefined) return fixed;
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(' ');
}

/** Plain-English label for each decision. */
const RESULT_LABELS: Readonly<Record<string, string>> = {
  pass: 'Passed',
  fail: 'Failed',
  advisory: 'Needs attention',
  error: "Couldn't finish",
};

function resultBadge(decision: string): string {
  const label = RESULT_LABELS[decision] ?? decision;
  return `<span class="badge badge--result-${esc(decision)}">${esc(label)}</span>`;
}

/** `2026-10-04T05:43:42.321Z` -> `Oct 4, 2026` (UTC), keeping the exact time in `datetime`. */
export function readableDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** The links cell: the test definition (when resolvable) and the signed record. */
function linksCell(row: ResultsRow): string {
  const links: string[] = [];
  const spec = row.policyRef === undefined ? null : specUrl(row.repo, row.policyRef, row.commitSha);
  if (spec !== null) links.push(`<a href="${esc(spec)}">See the test</a>`);
  links.push(`<a href="${esc(bundleUrl(row.repo, row.bundleKey))}">Signed record</a>`);
  return links.join(' · ');
}

/**
 * The "what happened" cell: every signed reason, verbatim and in order, minus
 * the "rollout decision is ..." line, which only restates the Result column.
 */
function whatHappened(row: ResultsRow): string {
  const reasons = (row.reasons ?? []).filter((r) => !/^rollout decision is /i.test(r));
  if (reasons.length === 0) return '<code>—</code>';
  if (reasons.length === 1) return esc(reasons[0] ?? '');
  return `<ul class="reasons">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
}

/** One `/evals/` table row. */
function evalTr(row: ResultsRow, showProject: boolean, staleSince?: string): string {
  const stale =
    staleSince === undefined
      ? ''
      : ` <span class="badge badge--stale">not updated since ${esc(readableDate(staleSince))}</span>`;
  const project = showProject
    ? `\n                    <td><a href="${esc(repoUrl(row.repo))}">${esc(projectName(row.repo))}</a>${stale}</td>`
    : '';
  const nameStale = showProject ? '' : stale;
  return `                <tr>
                    <td><strong>${esc(readableName(row.gateName))}</strong>${nameStale}</td>${project}
                    <td>${resultBadge(row.decision)}</td>
                    <td>${whatHappened(row)}</td>
                    <td><time datetime="${esc(row.evaluatedAt)}">${esc(readableDate(row.evaluatedAt))}</time></td>
                    <td>${linksCell(row)}</td>
                </tr>`;
}

/** One `/evals/` section: heading, one-line explanation, table. */
function evalSection(
  heading: string,
  explainer: string,
  rows: readonly ResultsRow[],
  showProject: boolean,
  stale: ReadonlyMap<string, string>,
): string {
  if (rows.length === 0) return '';
  const head = showProject
    ? '<th>What was tested</th><th>Project</th><th>Result</th><th>What happened</th><th>Tested on</th><th>Links</th>'
    : '<th>Skill</th><th>Result</th><th>What happened</th><th>Tested on</th><th>Links</th>';
  return `        <section class="all-evals">
            <h2>${esc(heading)}</h2>
            <p>${esc(explainer)}</p>
            <div class="table-scroll" role="region" aria-label="${esc(heading)}" tabindex="0"><table class="results-table">
                <thead>
                    <tr>${head}</tr>
                </thead>
                <tbody>
${rows.map((r) => evalTr(r, showProject, stale.get(r.repo))).join('\n')}
                </tbody>
            </table></div>
        </section>`;
}

/**
 * Render `/evals/`: every published test result on one page, written for a
 * reader who has never seen the platform. Rows are split into AI skill tests
 * and platform checks; nothing is counted or added up (C3), no-data sources
 * are named, and the technical identifiers live on the signed record pages.
 */
export function renderAllEvalsPage(view: ResultsView): string {
  const title = 'Every published test | Intent Labs';
  const description =
    'Every automated test result Intent Labs publishes, in plain English, with links to what was tested and the signed record.';
  const all = view.repos.flatMap((r) => r.rows);
  const byName = (a: ResultsRow, b: ResultsRow): number =>
    readableName(a.gateName).localeCompare(readableName(b.gateName));
  const skillRows = all.filter((r) => SKILL_TEST_REPOS.has(r.repo)).sort(byName);
  const platformRows = all
    .filter((r) => !SKILL_TEST_REPOS.has(r.repo))
    .sort((a, b) => projectName(a.repo).localeCompare(projectName(b.repo)) || byName(a, b));
  const stale = new Map(
    view.repos.filter((r) => r.staleSince !== undefined).map((r) => [r.repo, r.staleSince ?? '']),
  );
  const predicateUris = [...new Set(all.map((r) => r.predicateUri))].sort();

  const sections = [
    evalSection(
      'AI skill tests',
      'Every night we give each AI skill a set of real tasks and grade the finished work against its written rules. A skill passes only if it meets every required rule.',
      skillRows,
      false,
      stale,
    ),
    evalSection(
      'Platform checks',
      'Automated quality checks on the code behind this lab and our skills marketplace, such as tests, security scans and catalog rules.',
      platformRows,
      true,
      stale,
    ),
  ].filter((x) => x !== '');

  const empty = view.repos.filter((r) => r.noData).map((r) => r.repo);
  const emptyNote =
    empty.length === 0
      ? ''
      : `        <div class="no-data-panel">
            <p class="no-data-panel__title"><span class="badge badge--no-data">No data</span> Nothing published yet from: ${empty.map((r) => `<a href="${esc(repoUrl(r))}">${esc(projectName(r))}</a>`).join(', ')}.</p>
            <p>No data is not a pass. It means we have no verified result to show.</p>
        </div>`;
  const body =
    sections.length === 0
      ? `        <p>No verified test results have been published yet.</p>`
      : sections.join('\n');
  const updated =
    view.asOf === undefined
      ? `        <p><strong>Last updated:</strong> no verified results yet.</p>`
      : `        <p><strong>Last updated:</strong> <time datetime="${esc(view.asOf)}">${esc(readableDate(view.asOf))}</time>. Some projects may be newer; each row shows its own test date.</p>`;
  const footnote =
    predicateUris.length === 0
      ? ''
      : `        <p class="predicate-note">Technical note: each row is one signed, tamper-evident record (${predicateUris.map((u) => `<code>${esc(u)}</code>`).join(', ')}). Open "Signed record" for the hashes, timestamps and transparency-log entry. <a href="/methodology/#evidence">How to read the evidence</a>.</p>`;

  return `${PAGE_HEAD(title, description, ALL_EVALS_URL)}
<body>
${SITE_HEADER}
    <main>
        <h1>Every published test</h1>
        <p class="lead">This page lists every automated test result we publish. Each row is one test that ran on its own. Results are never added up into a single score.</p>
        <div class="meta-block">
            <p style="margin-top:0;"><strong>How to read a result</strong></p>
            <ul>
                <li>${resultBadge('pass')} met every required rule.</li>
                <li>${resultBadge('fail')} missed at least one required rule.</li>
                <li>${resultBadge('advisory')} finished, but something should be reviewed by a person.</li>
                <li>${resultBadge('error')} the test itself broke, so there is no verdict.</li>
            </ul>
            <p><strong>Words you will see</strong></p>
            <ul>
                <li><strong>Criteria</strong> are the written rules each finished task is graded against.</li>
                <li>A <strong>blocker</strong> is a rule that must pass. Missing one means Failed. Missing a non-blocker means Needs attention.</li>
                <li><strong>Could not be judged</strong> means the grader could not decide whether a rule was met. It never counts as a pass.</li>
                <li><strong>Regression comparison</strong> checks the skill against its previous version. Until that comparison runs, even a perfect score stays at Needs attention.</li>
                <li><strong>Thresholds</strong> are the minimum scores the skill must reach overall.</li>
            </ul>
            <p style="margin-bottom:0;"><strong>See the test</strong> opens exactly what was checked. <strong>Signed record</strong> opens the tamper-evident proof of the result.</p>
        </div>
${updated}
${emptyNote}
${body}
${footnote}
        <p><a href="/results/">Browse results by project →</a></p>
    </main>
${SITE_FOOTER}`;
}
