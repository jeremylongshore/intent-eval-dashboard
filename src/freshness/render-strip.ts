/**
 * HTML rendering for the freshness + decision-mix strip and the `/status` route.
 *
 * Two surfaces, both self-contained HTML matching the labs.intentsolutions.io
 * single-file pattern (shared `/style.css`, no JS):
 *
 *   1. `renderFreshnessStrip(view)` — the strip FRAGMENT injected at the TOP of
 *      the landing page (`site/index.html`). One row per source repo, 24 hourly
 *      bucket cells. Each cell's color = its decision-mix kind. `no-data` shares
 *      the LOUD fail-equal treatment (CMO C4) — never blank, never neutral.
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

import { esc } from '../results/render-html.js';
import {
  type BucketKind,
  type DecisionBucket,
  type FreshnessStripView,
  type RepoFreshnessRow,
} from './bucket-model.js';
import { type IngestUseView } from './use-model.js';

/** CSS modifier for a bucket cell, by kind. `no-data` reuses the loud style. */
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
    return `${b.hourStartIso} — no verified data this hour (no-data; shown as loudly as a failure, never filled)`;
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
        `<td class="${bucketClass(b.kind)}" title="${esc(bucketTitle(b))}"><span class="bucket__glyph" aria-hidden="true">${bucketGlyph(b.kind)}</span><span class="sr-only">${esc(b.kind)}</span></td>`,
    )
    .join('');
  const rowFlag = row.allNoData
    ? ` <span class="badge badge--no-data">no-data — silent ${esc(String(row.buckets.length))}h</span>`
    : row.lastSeenInWindowIso !== undefined
      ? ` <span class="badge badge--stale" title="most recent hour is no-data">last verified ${esc(row.lastSeenInWindowIso)}</span>`
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
    ? `            <p class="strip__note strip__note--silent">Sources showing <span class="badge badge--no-data">no-data</span> across the whole window have published no verified, signed Evidence Bundle in the last 24 hours. <strong>This is the honest current state</strong> — emit-evidence is still rolling out upstream. We render the silence loudly rather than fill it.</p>`
    : '';
  return `        <section class="freshness-strip-grid" aria-labelledby="freshness-strip-h">
            <h2 id="freshness-strip-h">Per-repo freshness — last 24 hours</h2>
            <p class="strip__lead">One row per source repo. Each cell is one hour; its color is the decision mix of verified gate-result rows in that hour. <code>no-data</code> is colored as loudly as a failure — an hour we heard nothing verified is never blank, never neutral, and never back-filled with a prior value.</p>
            <div class="strip__scroll">
            <table class="freshness-strip-grid__table">
                <caption class="sr-only">Per-repo hourly decision mix over the last 24 hours. Rows are source repos; columns are hours, oldest on the left.</caption>
                <thead>
                    <tr>
                        <th scope="col">Source</th>
                        <th scope="col" colspan="${view.rows[0]?.buckets.length ?? 24}">← older &nbsp;·&nbsp; ${esc(view.windowStartIso)} → ${esc(view.nowIso)} &nbsp;·&nbsp; newer →</th>
                    </tr>
                </thead>
                <tbody>
${rows}
                </tbody>
            </table>
            </div>
${legendHtml()}
${honestNote}
            <p class="strip__statuslink"><a href="/status/">Ingest pipeline status (USE method) →</a></p>
        </section>`;
}

/** A compact color legend so the cells are legible without hovering. */
function legendHtml(): string {
  const items: { kind: BucketKind; label: string }[] = [
    { kind: 'pass', label: 'pass' },
    { kind: 'advisory', label: 'advisory' },
    { kind: 'error', label: 'error' },
    { kind: 'fail', label: 'fail' },
    { kind: 'no-data', label: 'no-data (loud, equal to fail)' },
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
    <title>Ingest status (USE method) — Intent Eval Platform</title>
    <meta name="description" content="USE-method observability (Utilization / Saturation / Errors) of the Intent Eval Platform ingest pipeline, plus the per-repo freshness strip.">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://labs.intentsolutions.io/status/">
    <link rel="stylesheet" href="/style.css">

    <meta property="og:title" content="Ingest status (USE method) — Intent Eval Platform">
    <meta property="og:description" content="Utilization / Saturation / Errors of the ingest pipeline, plus per-repo freshness.">
    <meta property="og:url" content="https://labs.intentsolutions.io/status/">
    <meta property="og:type" content="website">

    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
</head>`;

const STATUS_HEADER = `    <header class="site-header">
        <div class="site-header__inner">
            <a href="/" class="site-header__wordmark">IEP&nbsp;Labs</a>
            <nav class="site-nav" aria-label="Primary">
                <a href="/eval-sets/">Eval Sets</a>
                <a href="/results/">Results</a>
                <a href="/methodology/">Methodology</a>
                <a href="https://github.com/jeremylongshore/intent-eval-dashboard">GitHub</a>
            </nav>
        </div>
    </header>`;

const STATUS_FOOTER = `    <footer class="site-footer">
        <div class="site-footer__inner">
            <div>
                <strong>labs.intentsolutions.io</strong> · dashboard <code>v0.1.0</code> · <a href="/status/" class="footer__commitment">best-effort, single-operator, see /status for liveness</a><br>
                Intent Solutions — <a href="https://intentsolutions.io">intentsolutions.io</a>
            </div>
            <div>
                <a href="/methodology/">Methodology</a> ·
                <a href="/eval-sets/">Eval Sets</a> ·
                <a href="/results/">Results</a> ·
                <a href="/status/">Status</a>
            </div>
        </div>
    </footer>
</body>
</html>
`;

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
            <h3>Utilization</h3>
            <p class="use-card__metric"><strong>${esc(String(u.freshWorkers))}</strong> / ${esc(String(u.totalWorkers))} workers produced a fresh verified snapshot this pass <span class="use-card__pct">(${esc(pct(u.ratio))})</span></p>
            <p class="use-card__what">U — fraction of the ${esc(String(u.totalWorkers))}-worker ingest pool doing useful new work this pass. A worker serving only a prior-good snapshot is <em>not</em> utilized.</p>
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
  return `        <section class="use-card${escMod}">
            <h3>Saturation</h3>
            <p class="use-card__metric"><strong>${esc(String(s.restartCount))}</strong> restart${s.restartCount === 1 ? '' : 's'} in window <span class="use-card__pct">(${esc(pct(s.pressureRatio))} of budget ${esc(String(s.restartBudget))})</span></p>
            <p class="use-card__what">S — restart / back-off pressure on the supervision tree. Restarts are the queue-depth analogue: work backing up against the OTP restart budget. An escalation is maximal saturation.</p>
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
            <h3>Errors</h3>
            <p class="use-card__metric"><strong>${esc(String(e.crashCount))}</strong> worker crash${e.crashCount === 1 ? '' : 'es'} (verification / abnormal exit) this pass</p>
            <p class="use-card__what">E — workers that failed OIDC / Rekor / DSSE / schema verification or otherwise exited abnormally. Structured reasons preserved.</p>
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

/**
 * Render the full `/status/` page: USE cards for the ingest pipeline + the
 * freshness strip. `strip` is the same view the landing page embeds.
 */
export function renderStatusPage(use: IngestUseView, strip: FreshnessStripView): string {
  const silent =
    use.fullySilentRepos.length > 0
      ? `        <div class="meta-block as-of--none">
            <p style="margin:0;"><strong>Fully silent sources (24h):</strong> ${use.fullySilentRepos.map((r) => `<code>${esc(r)}</code>`).join(', ')} — the dashboard has heard <em>nothing verified</em> from these in the window. Rendered loudly; never inferred.</p>
        </div>`
      : `        <div class="meta-block as-of">
            <p style="margin:0;">No fully-silent sources in the last 24 hours.</p>
        </div>`;
  return `${STATUS_HEAD()}
<body>
${STATUS_HEADER}
    <main>
        <p><a href="/">← Home</a></p>
        <h1>Ingest pipeline status</h1>
        <p class="lead">
            USE-method observability — <strong>U</strong>tilization, <strong>S</strong>aturation, <strong>E</strong>rrors — of the ${use.utilization.totalWorkers}-worker ingest pipeline <em>itself</em> (Brendan Gregg's method). This is the health of the machine that produces this dashboard, distinct from what the evals say. As of <time datetime="${esc(use.nowIso)}">${esc(use.nowIso)}</time>.
        </p>
        <p>This is a rendered status view, not a pager. Alerting lives elsewhere; here we just show the current pipeline state honestly.</p>
${silent}
${renderUseCards(use)}
        <h2>What the sources are reporting</h2>
        <p>The same per-repo decision-mix strip the home page carries — system health (above) and result mix (below) side by side.</p>
${renderFreshnessStrip(strip)}
    </main>
${STATUS_FOOTER}`;
}
