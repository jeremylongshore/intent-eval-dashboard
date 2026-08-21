/**
 * Tailnet-only consumer for j-rig's versioned unified evaluation report.
 *
 * The report is a local projection over generic Runs and one immutable named
 * Grader. It is deliberately NOT an Evidence Bundle and it is deliberately
 * NOT a rollout decision. The J-Rig repository owns the wire contract; this
 * module repeats only the defensive boundary needed before a static page is
 * rendered, so a malformed local file fails closed instead of becoming a
 * dashboard assertion.
 *
 * This module never writes to the public `site/` tree. Its writer refuses a
 * destination whose basename is `site`, and emits only below the
 * operator-internal `internal/eval-reports/j-rig/` URL space.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { esc, SITE_FOOTER } from '../results/render-html.js';

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const GradeSelectorSchema = z
  .object({
    grader_id: z.string().min(1),
    grader_version: z.string().min(1),
    grader_snapshot_sha256: Sha256DigestSchema,
  })
  .strict();

const ConfidenceIntervalSchema = z
  .object({
    lower: z.number().min(0).max(1),
    upper: z.number().min(0).max(1),
    confidence_level: z.literal(0.95),
  })
  .strict()
  .nullable();

const GradeMeasurementSchema = z
  .object({
    task_id: z.string().min(1),
    task_version: z.string().min(1),
    config_id: z.string().min(1),
    config_version: z.string().min(1),
    model: z.string().min(1),
    grader_id: z.string().min(1),
    grader_version: z.string().min(1),
    grader_snapshot_sha256: Sha256DigestSchema,
    attempted_runs: z.number().int().nonnegative(),
    completed_runs: z.number().int().nonnegative(),
    active_runs: z.number().int().nonnegative(),
    harness_failure_count: z.number().int().nonnegative(),
    graded_runs: z.number().int().nonnegative(),
    ungraded_completed_runs: z.number().int().nonnegative(),
    pass_count: z.number().int().nonnegative(),
    fail_count: z.number().int().nonnegative(),
    pass_rate: z.number().min(0).max(1).nullable(),
    standard_error: z.number().nonnegative().nullable(),
    confidence_interval_95: ConfidenceIntervalSchema,
    mean_score: z.number().nullable(),
    score_standard_error: z.number().nonnegative().nullable(),
  })
  .strict();

const SamplingGradeSchema = z
  .object({
    grader_id: z.string().min(1),
    grader_version: z.string().min(1),
    grader_snapshot_sha256: Sha256DigestSchema,
    verdict: z.enum(['pass', 'fail']),
    score: z.number(),
  })
  .strict();

const UnifiedReportRunSchema = z
  .object({
    raw_run_id: z.string().min(1),
    task_id: z.string().min(1),
    task_version: z.string().min(1),
    config_id: z.string().min(1),
    config_version: z.string().min(1),
    model: z.string().min(1),
    sample_index: z.number().int().nonnegative(),
    status: z.enum(['pending', 'running', 'completed', 'runner_error', 'timed_out']),
    grade: SamplingGradeSchema.nullable(),
  })
  .strict();

const ReportSummarySchema = z
  .object({
    cell_count: z.number().int().nonnegative(),
    attempted_runs: z.number().int().nonnegative(),
    completed_runs: z.number().int().nonnegative(),
    active_runs: z.number().int().nonnegative(),
    harness_failure_count: z.number().int().nonnegative(),
    graded_runs: z.number().int().nonnegative(),
    ungraded_completed_runs: z.number().int().nonnegative(),
    pass_count: z.number().int().nonnegative(),
    fail_count: z.number().int().nonnegative(),
  })
  .strict();

/** The wire contract emitted by `j-rig report --unified --json`. */
export const UnifiedReportSchema = z
  .object({
    schema: z.literal('j-rig/unified-report/v1'),
    generated_at: z.string().min(1),
    grader: GradeSelectorSchema,
    summary: ReportSummarySchema,
    cells: z.array(GradeMeasurementSchema),
    runs: z.array(UnifiedReportRunSchema),
  })
  .strict();

export type UnifiedReport = z.infer<typeof UnifiedReportSchema>;

/** Parse a report at the dashboard boundary; malformed input fails closed. */
export function parseUnifiedReport(input: unknown): UnifiedReport {
  const parsed = UnifiedReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid j-rig unified report: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** A generated file relative to the operator-internal site root. */
export interface UnifiedReportFile {
  readonly path: string;
  readonly html: string;
}

const REPORT_PATH = 'internal/eval-reports/j-rig/index.html';

const REPORT_HEADER = `    <header class="site-header site-header--internal">
        <div class="site-header__inner">
            <a href="/internal/eval-reports/j-rig/" class="site-header__wordmark">IEP&nbsp;Labs · <span class="badge badge--internal">OPERATOR</span></a>
            <nav class="site-nav" aria-label="Primary">
                <a href="/internal/results/">Internal results</a>
                <a href="/results/">Public results</a>
                <a href="/status/">Status</a>
                <a href="https://github.com/jeremylongshore/intent-eval-dashboard">GitHub</a>
            </nav>
        </div>
    </header>`;

function text(value: string | number): string {
  return esc(String(value));
}

function optionalText(value: number | null): string {
  return value === null ? '<span class="eval-report-muted">—</span>' : text(value);
}

function percentage(value: number | null): string {
  return value === null
    ? '<span class="eval-report-muted">—</span>'
    : `${text((value * 100).toFixed(1))}%`;
}

function score(value: number | null): string {
  return value === null ? '<span class="eval-report-muted">—</span>' : text(value.toFixed(3));
}

function decimal(value: number | null): string {
  return value === null ? '<span class="eval-report-muted">—</span>' : text(value.toFixed(3));
}

function interval(value: UnifiedReport['cells'][number]['confidence_interval_95']): string {
  return value === null
    ? '<span class="eval-report-muted">—</span>'
    : `[${text((value.lower * 100).toFixed(1))}%, ${text((value.upper * 100).toFixed(1))}%]`;
}

function statusClass(status: UnifiedReport['runs'][number]['status']): string {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'runner_error':
    case 'timed_out':
      return 'harness-error';
    case 'pending':
    case 'running':
      return 'active';
  }
}

function statusLabel(status: UnifiedReport['runs'][number]['status']): string {
  return status === 'runner_error' ? 'harness-error' : text(status);
}

function gradeLabel(grade: UnifiedReport['runs'][number]['grade']): string {
  if (grade === null) return '<span class="eval-report-muted">ungraded</span>';
  return `<span class="badge badge--result-${text(grade.verdict)}">${text(grade.verdict)}</span>`;
}

function renderSummary(report: UnifiedReport): string {
  const cards: readonly (readonly [string, number, string])[] = [
    ['Cells', report.summary.cell_count, 'Explicit Task × Config × Model cells'],
    ['Attempted runs', report.summary.attempted_runs, 'Raw Run records in the projection'],
    ['Completed runs', report.summary.completed_runs, 'Runs with a completed lifecycle'],
    ['Active runs', report.summary.active_runs, 'Pending or currently running'],
    ['Harness errors', report.summary.harness_failure_count, 'Runner errors or timeouts'],
    ['Graded runs', report.summary.graded_runs, 'Runs selected by this Grader snapshot'],
    ['Pass verdicts', report.summary.pass_count, 'Count only; no global pass-rate is shown'],
    ['Fail verdicts', report.summary.fail_count, 'Count only; no global pass-rate is shown'],
  ];
  return `        <section aria-labelledby="eval-report-summary-heading">
            <h2 id="eval-report-summary-heading">Report summary</h2>
            <div class="eval-report-summary">
${cards
  .map(
    ([label, value, note]) => `                <article class="eval-report-card">
                    <h3>${text(label)}</h3>
                    <p class="eval-report-card__value">${text(value)}</p>
                    <p class="eval-report-card__note">${text(note)}</p>
                </article>`,
  )
  .join('\n')}
            </div>
        </section>`;
}

function renderNoData(report: UnifiedReport): string {
  if (report.summary.graded_runs > 0) return '';
  return `        <section class="eval-report-no-data" role="alert" aria-labelledby="eval-report-no-data-heading">
            <h2 id="eval-report-no-data-heading"><span class="badge badge--no-data">no-data</span> No graded decision is available</h2>
            <p>This report contains no completed run selected by the named Grader snapshot. Pending work, harness errors, and ungraded completions are not a pass. Review the cell and raw Run tables before treating this report as evidence.</p>
        </section>`;
}

function renderCellTable(report: UnifiedReport): string {
  const rows = report.cells
    .map(
      (cell) => `                <tr>
                    <td><code>${text(cell.task_id)}@${text(cell.task_version)}</code></td>
                    <td><code>${text(cell.config_id)}@${text(cell.config_version)}</code></td>
                    <td><code>${text(cell.model)}</code></td>
                    <td>${text(cell.completed_runs)}</td>
                    <td>${text(cell.graded_runs)}</td>
                    <td>${percentage(cell.pass_rate)}</td>
                    <td>${decimal(cell.standard_error)}</td>
                    <td>${interval(cell.confidence_interval_95)}</td>
                    <td>${optionalText(cell.harness_failure_count)}</td>
                    <td>${optionalText(cell.ungraded_completed_runs)}</td>
                    <td>${score(cell.mean_score)}</td>
                    <td>${score(cell.score_standard_error)}</td>
                </tr>`,
    )
    .join('\n');
  const empty =
    report.cells.length === 0
      ? `                <tr><td colspan="12" class="eval-report-empty">No cells in this report.</td></tr>`
      : '';
  return `        <section aria-labelledby="eval-report-cells-heading">
            <h2 id="eval-report-cells-heading">Cell measurements</h2>
            <p class="eval-report-section-note">Metrics stay at the explicit Task × Config × Model cell. The dashboard does not collapse heterogeneous cells into one pass-rate.</p>
            <div class="eval-report-table-wrap">
                <table class="eval-report-table">
                    <caption class="sr-only">Per-cell measurements for the selected named Grader snapshot</caption>
                    <thead>
                        <tr>
                            <th scope="col">Task</th>
                            <th scope="col">Config</th>
                            <th scope="col">Model</th>
                            <th scope="col">Completed</th>
                            <th scope="col">Graded</th>
                            <th scope="col">Cell pass rate</th>
                            <th scope="col">Pass SE</th>
                            <th scope="col">Wilson 95%</th>
                            <th scope="col">Harness errors</th>
                            <th scope="col">Ungraded</th>
                            <th scope="col">Mean score</th>
                            <th scope="col">Score SE</th>
                        </tr>
                    </thead>
                    <tbody>
${rows}${empty}
                    </tbody>
                </table>
            </div>
        </section>`;
}

function renderRunTable(report: UnifiedReport): string {
  const rows = report.runs
    .map(
      (run) => `                <tr>
                    <td><code>${text(run.raw_run_id)}</code></td>
                    <td><code>${text(run.task_id)}@${text(run.task_version)}</code></td>
                    <td><code>${text(run.config_id)}@${text(run.config_version)}</code></td>
                    <td><code>${text(run.model)}</code></td>
                    <td>${text(run.sample_index)}</td>
                    <td><span class="eval-report-status eval-report-status--${statusClass(run.status)}">${statusLabel(run.status)}</span></td>
                    <td>${gradeLabel(run.grade)}</td>
                </tr>`,
    )
    .join('\n');
  const empty =
    report.runs.length === 0
      ? `                <tr><td colspan="7" class="eval-report-empty">No raw Runs in this report.</td></tr>`
      : '';
  return `        <section aria-labelledby="eval-report-runs-heading">
            <h2 id="eval-report-runs-heading">Raw Run lineage</h2>
            <p class="eval-report-section-note">Lifecycle failures remain visible and are never silently converted into pass or fail verdicts.</p>
            <div class="eval-report-table-wrap">
                <table class="eval-report-table">
                    <caption class="sr-only">Raw Run records included in the unified report</caption>
                    <thead>
                        <tr>
                            <th scope="col">Raw Run</th>
                            <th scope="col">Task</th>
                            <th scope="col">Config</th>
                            <th scope="col">Model</th>
                            <th scope="col">Sample</th>
                            <th scope="col">Lifecycle</th>
                            <th scope="col">Grader verdict</th>
                        </tr>
                    </thead>
                    <tbody>
${rows}${empty}
                    </tbody>
                </table>
            </div>
        </section>`;
}

/** Render a validated unified report as a static, tailnet-only HTML page. */
export function renderUnifiedReport(report: UnifiedReport): string {
  const title = 'J-Rig unified evaluation report — operator internal';
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${text(title)}</title>
    <meta name="description" content="Tailnet-only local projection of a J-Rig unified evaluation report.">
    <meta name="robots" content="noindex, nofollow">
    <meta name="iep-surface" content="tailnet-only">
    <meta name="iep-view" content="j-rig-unified-report">
    <meta name="iep-report-trust" content="unsigned-local-projection">
    <link rel="stylesheet" href="/style.css">
</head>
<body>
${REPORT_HEADER}
    <main class="eval-report-main">
        <div class="eval-report-banner" role="note">
            <p><strong>Operator-internal · tailnet-only.</strong> This is a local, unsigned projection of J-Rig's <code>${text(report.schema)}</code> report. It is not a signed Evidence Bundle, not a public result, and not a rollout decision.</p>
        </div>
        <header class="eval-report-lead">
            <p class="eval-report-eyebrow">J-Rig evaluation substrate</p>
            <h1>Unified evaluation report</h1>
            <p class="lead">A compact evidence ledger over immutable Raw Runs and one explicitly selected immutable Grader snapshot. Cell-level statistics and lifecycle failures remain visible for operator review.</p>
        </header>
        <section class="meta-block eval-report-meta" aria-labelledby="eval-report-meta-heading">
            <h2 id="eval-report-meta-heading" class="sr-only">Report identity</h2>
            <dl>
                <dt>schema</dt><dd><code>${text(report.schema)}</code></dd>
                <dt>generated at</dt><dd><time datetime="${text(report.generated_at)}">${text(report.generated_at)}</time></dd>
                <dt>grader</dt><dd><code>${text(report.grader.grader_id)}@${text(report.grader.grader_version)}</code></dd>
                <dt>grader snapshot</dt><dd><code>${text(report.grader.grader_snapshot_sha256)}</code></dd>
                <dt>publication boundary</dt><dd>tailnet-only, noindex, unsigned local projection</dd>
            </dl>
        </section>
${renderNoData(report)}
${renderSummary(report)}
${renderCellTable(report)}
${renderRunTable(report)}
    </main>
${SITE_FOOTER}`;
}

/** Generate the single static file for the J-Rig report lane. */
export function generateUnifiedReportFiles(report: UnifiedReport): UnifiedReportFile[] {
  return [{ path: REPORT_PATH, html: renderUnifiedReport(report) }];
}

function assertSafeOutputRoot(internalSiteRoot: string): string {
  const root = resolve(internalSiteRoot);
  if (basename(root) === 'site') {
    throw new Error(
      'writeUnifiedReportSite: refusing to write tailnet-only output into the public origin "site/"',
    );
  }
  return root;
}

function assertSafeOutputPath(root: string, path: string): string {
  const absolute = resolve(root, path);
  const relativePath = relative(root, absolute);
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`writeUnifiedReportSite: refusing path outside output root: ${path}`);
  }
  return absolute;
}

/** Write the generated report below an operator-internal site root. */
export async function writeUnifiedReportSite(
  files: readonly UnifiedReportFile[],
  internalSiteRoot: string,
): Promise<string[]> {
  const root = assertSafeOutputRoot(internalSiteRoot);
  const written: string[] = [];
  for (const file of files) {
    const absolute = assertSafeOutputPath(root, file.path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, file.html, 'utf8');
    written.push(absolute);
  }
  return written;
}

/** Exposed for the CLI/tests so the generated URL space stays centralized. */
export const unifiedReportPath = join('/', REPORT_PATH);
