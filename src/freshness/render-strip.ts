/**
 * HTML rendering for the freshness + decision-mix strip and the `/status` route.
 *
 * Two surfaces, both self-contained HTML matching the labs.intentsolutions.io
 * single-file pattern (shared `/style.css`, no JS):
 *
 *   1. `renderFreshnessStrip(view)` — the strip FRAGMENT injected at the TOP of
 *      the landing page (`site/index.html`). One row per source repo, 24 hourly
 *      bucket cells. Each cell's color = its decision-mix kind. `no-data` is
 *      explicitly labeled and visually distinct from failure (DR-035 C4).
 *
 *   2. `renderStatusPage(use, strip)` — the `/status` route, a USE-method view
 *      of the INGEST PIPELINE itself (Utilization / Saturation / Errors), plus
 *      the same strip so an operator sees both system health and result mix.
 *
 * ── C3 SAFETY (the no-aggregate-PASS% binding) ──
 *
 * This strip has NO predicate-URI dimension at all: it never references a
 * predicate URI, and it never renders an `X/N pass` or `X% pass` token. The
 * per-bucket tooltip shows an explicit per-decision breakdown (`pass: N · fail:
 * M · …`) — never a composited fraction or percent. So the generated output is
 * structurally incapable of tripping the C3 scanner (`src/results/c3-scan.ts`),
 * which only flags an aggregate-pass token co-located with >= 2 predicate URIs.
 * We keep it that way on purpose.
 */

import { esc, SITE_HEADER, SITE_FOOTER } from '../results/render-html.js';
import {
  type BucketKind,
  type DecisionBucket,
  type FreshnessStripView,
  type RepoFreshnessRow,
} from './bucket-model.js';
import { type IngestUseView } from './use-model.js';

/** CSS modifier for a bucket cell; absence and failure remain separate states. */
function bucketClass(kind: BucketKind): string {
  return `bucket bucket--${kind}`;
}

/**
 * Human label for a bucket cell's title (hover tooltip).
 *
 * Explicit per-decision breakdown within the hour — NOT an aggregate pass-rate.
 * For an empty hour it states the no-data hole plainly so the absence is legible
 * even to a screen reader, not just visually loud.
 */
function bucketTitle(b: DecisionBucket): string {
  if (b.total === 0) {
    return `${b.hourStartIso}: No verified result published this hour. The test outcome is unknown, not a pass or a failure.`;
  }
  const order: (keyof DecisionBucket['counts'])[] = ['pass', 'fail', 'advisory', 'error'];
  const parts = order
    .filter((d) => b.counts[d] > 0)
    .map((d) => `${d}: ${b.counts[d]}`)
    .join(' · ');
  return `${b.hourStartIso} — ${parts}`;
}

/** Accessible text inside a cell: a glyph that encodes the kind (color-blind safe). */
function bucketGlyph(kind: BucketKind): string {
  switch (kind) {
    case 'pass':
      return '✓';
    case 'fail':
      return '✕';
    case 'advisory':
      return '!';
    case 'error':
      return '?';
    case 'no-data':
      return '·';
  }
}

/** Render one repo's 24-cell bucket row. */
function repoRowHtml(row: RepoFreshnessRow): string {
  const cells = row.buckets
    .map(
      (b) =>
        `<td class="${bucketClass(b.kind)}" title="${esc(bucketTitle(b))}"><span class="bucket__glyph" aria-hidden="true">${bucketGlyph(b.kind)}</span><span class="sr-only">${esc(bucketTitle(b))}</span></td>`,
    )
    .join('');
  const rowFlag = row.allNoData
    ? ` <span class="badge badge--no-data">No results in this window</span>`
    : row.lastSeenInWindowIso !== undefined
      ? ` <span class="strip__last-result">Last result: <time datetime="${esc(row.lastSeenInWindowIso)}">${esc(row.lastSeenInWindowIso)}</time></span>`
      : '';
  return `                <tr>
                    <th scope="row" class="strip__repo"><a href="/results/${esc(row.repo)}/"><code>${esc(row.repo)}</code></a>${rowFlag}</th>
                    ${cells}
                </tr>`;
}

/**
 * Render the freshness-strip FRAGMENT for embedding in the landing page.
 *
 * Returns an HTML block (a `<section class="freshness-strip-grid">…</section>`)
 * with NO surrounding document chrome — the caller injects it into the landing
 * `<main>`.
 */
export function renderFreshnessStrip(view: FreshnessStripView): string {
  const rows = view.rows.map(repoRowHtml).join('\n');
  const anySilent = view.rows.some((r) => r.allNoData);
  const honestNote = anySilent
    ? `            <p class="strip__note strip__note--silent"><strong>Some sources have no verified results in this window.</strong> Their test outcomes are unknown. This does not tell us whether a test was expected or why no result was published. We never fill a gap with an older pass.</p>`
    : '';
  return `        <section class="freshness-strip-grid" aria-labelledby="freshness-strip-h">
            <h2 id="freshness-strip-h">Published test results by hour</h2>
            <p class="strip__lead">One row per source, one cell per hour, over the last 24 hours. Colored cells show published test outcomes; gray dots mean no verified result was published. <strong>No result is not a failed test.</strong> An empty hour is not automatically overdue: tests may run daily or only when something changes.</p>
            <div class="strip__scroll" role="region" aria-label="Hourly test results. Scroll horizontally to see all hours." tabindex="0">
            <table class="freshness-strip-grid__table">
                <caption class="sr-only">Published test outcomes over the last 24 hours. Rows are source repos; columns are hours in UTC, oldest on the left. A cell shows the most severe outcome in that hour; its description lists all outcome counts.</caption>
                <thead>
                    <tr>
                        <th scope="col">Source</th>
                        <th scope="col" colspan="${view.rows[0]?.buckets.length ?? 24}">← older &nbsp;·&nbsp; ${esc(view.windowStartIso)} → ${esc(view.nowIso)} &nbsp;·&nbsp; newer → (UTC)</th>
                    </tr>
                </thead>
                <tbody>
${rows}
                </tbody>
            </table>
            </div>
${legendHtml()}
${honestNote}
            <p class="strip__statuslink"><a href="/status/">View data collection status →</a></p>
        </section>`;
}

/** A compact color legend so the cells are legible without hovering. */
function legendHtml(): string {
  const items: { kind: BucketKind; label: string }[] = [
    { kind: 'pass', label: 'Passed' },
    { kind: 'advisory', label: 'Advisory' },
    { kind: 'error', label: 'Could not evaluate' },
    { kind: 'fail', label: 'Failed' },
    { kind: 'no-data', label: 'No result (unknown)' },
  ];
  const lis = items
    .map(
      (i) =>
        `<li><span class="${bucketClass(i.kind)} bucket--legend" aria-hidden="true"><span class="bucket__glyph">${bucketGlyph(i.kind)}</span></span> ${esc(i.label)}</li>`,
    )
    .join('');
  return `            <ul class="strip__legend">${lis}</ul>`;
}

// ── /status route ──────────────────────────────────────────────────────────

const STATUS_HEAD = (): string => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Lab status | Intent Labs</title>
    <meta name="description" content="Check how the lab collected its latest data, then inspect published test outcomes. Missing results are shown separately from failures.">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://labs.intentsolutions.io/status/">
    <link rel="stylesheet" href="/style.css">

    <meta property="og:title" content="Lab status | Intent Labs">
    <meta property="og:description" content="Data collection status and published test outcomes, with missing results clearly labeled.">
    <meta property="og:url" content="https://labs.intentsolutions.io/status/">
    <meta property="og:type" content="website">

    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
</head>`;

const STATUS_HEADER = SITE_HEADER;

const STATUS_FOOTER = SITE_FOOTER;

/** A 0..1 ratio as a whole-number percent string (for the system-health gauges). */
function pct(ratio: number): string {
  return `${Math.round(clamp01(ratio) * 100)}%`;
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Render the Utilization card. */
function utilizationCard(use: IngestUseView): string {
  const u = use.utilization;
  const stale =
    u.staleRepos.length > 0
      ? `<p class="use-card__detail">Serving prior-good (stale) snapshot: ${u.staleRepos.map((r) => `<code>${esc(r)}</code>`).join(', ')} — not counted as utilized.</p>`
      : '';
  return `        <section class="use-card">
            <h3>Source checks</h3>
            <p class="use-card__metric"><strong>${esc(String(u.freshWorkers))}</strong> / ${esc(String(u.totalWorkers))} workers returned a fresh verified snapshot at this update <span class="use-card__pct">(${esc(pct(u.ratio))})</span></p>
            <p class="use-card__what">Utilization: successful source checks, not passed tests. A verified snapshot can contain failed tests or no test results.</p>
${stale}
        </section>`;
}

/** Render the Saturation card. */
function saturationCard(use: IngestUseView): string {
  const s = use.saturation;
  const escMod = s.escalated ? ' use-card--alarm' : '';
  const escalations = s.escalated
    ? `<p class="use-card__detail use-card__detail--alarm">Escalated (supervisor gave up): ${s.escalatedChildIds.map((c) => `<code>${esc(c)}</code>`).join(', ')}.</p>`
    : '';
  const metric = s.measured
    ? `<strong>${esc(String(s.restartCount))}</strong> restart${s.restartCount === 1 ? '' : 's'} in window <span class="use-card__pct">(${esc(pct(s.pressureRatio))} of budget ${esc(String(s.restartBudget))})</span>`
    : '<strong>Not recorded</strong>';
  const explanation = s.measured
    ? 'Saturation: how often collection workers restarted in the recorded window. An escalation means the collector stopped retrying.'
    : 'This collector does not report worker restarts. No retry count is available for this update.';
  return `        <section class="use-card${escMod}">
            <h3>Collection retries</h3>
            <p class="use-card__metric">${metric}</p>
            <p class="use-card__what">${explanation}</p>
${escalations}
        </section>`;
}

/** Render the Errors card. */
function errorsCard(use: IngestUseView): string {
  const e = use.errors;
  const errMod = e.crashCount > 0 ? ' use-card--alarm' : '';
  const detail =
    e.crashes.length > 0
      ? `<ul class="use-card__crashes">${e.crashes
          .map(
            (c) =>
              `<li><code>${esc(c.repo)}</code> — crashed at <code>${esc(c.step)}</code> (<code>${esc(c.reasonCode)}</code>)</li>`,
          )
          .join('')}</ul>`
      : `<p class="use-card__detail">No verification or crash failures this pass.</p>`;
  return `        <section class="use-card${errMod}">
            <h3>Collection failures</h3>
            <p class="use-card__metric"><strong>${esc(String(e.crashCount))}</strong> worker crash${e.crashCount === 1 ? '' : 'es'} (verification / abnormal exit) this pass</p>
            <p class="use-card__what">Errors: source data could not be verified or a collection worker crashed. These are collection failures, separate from a skill failing a test.</p>
${detail}
        </section>`;
}

/**
 * Render the three USE cards (Utilization / Saturation / Errors) as a single
 * `.use-cards` block. Extracted so BOTH the public `/status/` page and the
 * tailnet-internal operator index (puxu.9) embed the identical USE-method view
 * without duplicating the card markup. Pure; no document chrome.
 */
export function renderUseCards(use: IngestUseView): string {
  return `        <div class="use-cards">
${utilizationCard(use)}
${saturationCard(use)}
${errorsCard(use)}
        </div>`;
}

/** Snapshot collection state only; never inferred from test-result buckets. */
function collectionSummary(use: IngestUseView): string {
  let kind: 'complete' | 'warning' | 'error' | 'unknown';
  let title: string;
  if (use.errors.crashCount > 0 || use.saturation.escalated) {
    kind = 'error';
    title = 'Data collection needs attention';
  } else if (use.utilization.totalWorkers === 0 || Number.isNaN(Date.parse(use.nowIso))) {
    kind = 'unknown';
    title = 'No collection status available';
  } else if (
    use.utilization.freshWorkers < use.utilization.totalWorkers ||
    use.utilization.staleRepos.length > 0
  ) {
    kind = 'warning';
    title = 'Some source checks need attention';
  } else if (use.saturation.measured && use.saturation.restartCount > 0) {
    kind = 'warning';
    title = 'Data collection completed with retries';
  } else {
    kind = 'complete';
    title = 'Data collection completed';
  }
  return `        <section class="collection-summary collection-summary--${kind}" aria-labelledby="collection-summary-h">
            <h2 id="collection-summary-h">${title}</h2>
            <p>This describes data collection at the recorded update, not whether the tested skills passed. Test outcomes are shown separately below.</p>
        </section>`;
}

/**
 * Render the full `/status/` page: USE cards for the ingest pipeline + the
 * freshness strip. `strip` is the same view the landing page embeds.
 */
export function renderStatusPage(use: IngestUseView, strip: FreshnessStripView): string {
  const silent =
    use.fullySilentRepos.length > 0
      ? `        <div class="meta-block collection-note">
            <p style="margin:0;"><strong>No verified test results in this window:</strong> ${use.fullySilentRepos.map((r) => `<code>${esc(r)}</code>`).join(', ')}. These sources may still have been checked successfully. Missing test results do not establish a collection failure.</p>
        </div>`
      : `        <div class="meta-block as-of">
            <p style="margin:0;">Every source has at least one verified test result in this window.</p>
        </div>`;
  return `${STATUS_HEAD()}
<body>
${STATUS_HEADER}
    <main>
        <p><a href="/">← Home</a></p>
        <h1>Lab status</h1>
        <p class="lead">
            Did the lab collect its data, and what did the tests find? These are two different questions.
        </p>
        <p class="status-updated">Snapshot from <time datetime="${esc(use.nowIso)}">${esc(use.nowIso)}</time> (UTC). This page records the last update, not live monitoring.</p>
${collectionSummary(use)}
${renderUseCards(use)}
        <p class="status-method">Collection metrics follow Brendan Gregg's USE method: utilization, saturation, and errors. They do not measure skill quality.</p>
${silent}
${renderFreshnessStrip(strip)}
    </main>
${STATUS_FOOTER}`;
}
