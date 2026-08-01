import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanForAggregatePass } from '../results/c3-scan.js';
import {
  generateUnifiedReportFiles,
  parseUnifiedReport,
  renderUnifiedReport,
  unifiedReportPath,
  writeUnifiedReportSite,
  type UnifiedReport,
} from './unified-report.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const GENERATED_AT = '2026-08-01T12:00:00.000Z';

function report(overrides: Partial<UnifiedReport['summary']> = {}): UnifiedReport {
  return parseUnifiedReport({
    schema: 'j-rig/unified-report/v1',
    generated_at: GENERATED_AT,
    grader: {
      grader_id: 'output-contains',
      grader_version: '1.0.0',
      grader_snapshot_sha256: DIGEST,
    },
    summary: {
      cell_count: 1,
      attempted_runs: 2,
      completed_runs: 1,
      active_runs: 1,
      harness_failure_count: 0,
      graded_runs: 1,
      ungraded_completed_runs: 0,
      pass_count: 1,
      fail_count: 0,
      ...overrides,
    },
    cells: [
      {
        task_id: 'task<one>',
        task_version: '1.0.0',
        config_id: 'default',
        config_version: '1.0.0',
        model: 'model-a',
        grader_id: 'output-contains',
        grader_version: '1.0.0',
        grader_snapshot_sha256: DIGEST,
        attempted_runs: 2,
        completed_runs: 1,
        active_runs: 1,
        harness_failure_count: 0,
        graded_runs: 1,
        ungraded_completed_runs: 0,
        pass_count: 1,
        fail_count: 0,
        pass_rate: 1,
        standard_error: 0,
        confidence_interval_95: {
          lower: 0.2065,
          upper: 1,
          confidence_level: 0.95,
        },
        mean_score: 1,
        score_standard_error: 0,
      },
    ],
    runs: [
      {
        raw_run_id: 'raw-run-<one>',
        task_id: 'task<one>',
        task_version: '1.0.0',
        config_id: 'default',
        config_version: '1.0.0',
        model: 'model-a',
        sample_index: 0,
        status: 'completed',
        grade: {
          grader_id: 'output-contains',
          grader_version: '1.0.0',
          grader_snapshot_sha256: DIGEST,
          verdict: 'pass',
          score: 1,
        },
      },
      {
        raw_run_id: 'raw-run-2',
        task_id: 'task<one>',
        task_version: '1.0.0',
        config_id: 'default',
        config_version: '1.0.0',
        model: 'model-a',
        sample_index: 1,
        status: 'running',
        grade: null,
      },
    ],
  });
}

describe('parseUnifiedReport', () => {
  it('accepts the versioned J-Rig report shape', () => {
    expect(parseUnifiedReport(report()).schema).toBe('j-rig/unified-report/v1');
  });

  it('fails closed for a wrong schema or malformed snapshot digest', () => {
    expect(() => parseUnifiedReport({ schema: 'j-rig/unified-report/v2' })).toThrow(
      'Invalid j-rig unified report',
    );
    expect(() =>
      parseUnifiedReport({
        ...report(),
        grader: { ...report().grader, grader_snapshot_sha256: 'not-a-digest' },
      }),
    ).toThrow('Invalid j-rig unified report');
    expect(() => parseUnifiedReport({ ...report(), unexpected: true })).toThrow(
      'Invalid j-rig unified report',
    );
  });
});

describe('renderUnifiedReport', () => {
  it('renders a dense, escaped, tailnet-only report without a global pass-rate', () => {
    const html = renderUnifiedReport(report());

    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta name="iep-surface" content="tailnet-only">');
    expect(html).toContain('<meta name="iep-report-trust" content="unsigned-local-projection">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain('output-contains@1.0.0');
    expect(html).toContain(DIGEST);
    expect(html).toContain('Cell measurements');
    expect(html).toContain('Raw Run lineage');
    expect(html).toContain('task&lt;one&gt;');
    expect(html).toContain('raw-run-&lt;one&gt;');
    expect(html).toContain('Cell pass rate');
    expect(html).toContain('Wilson 95%');
    expect(html).toContain('not a rollout decision');
    expect(scanForAggregatePass(html)).toEqual([]);
  });

  it('renders no-data loudly when no run has a selected grader verdict', () => {
    const noData = report({ graded_runs: 0, pass_count: 0, fail_count: 0 });
    const html = renderUnifiedReport(noData);

    expect(html).toContain('class="eval-report-no-data"');
    expect(html).toContain('No graded decision is available');
    expect(html).toContain('Pending work, harness errors, and ungraded completions are not a pass');
  });
});

describe('unified report output', () => {
  it('generates one stable internal path and writes it below site-internal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iep-dashboard-report-'));
    try {
      const files = generateUnifiedReportFiles(report());
      expect(files).toHaveLength(1);
      expect(files[0]?.path).toBe('internal/eval-reports/j-rig/index.html');
      expect(unifiedReportPath).toBe('/internal/eval-reports/j-rig/index.html');

      const internalRoot = join(root, 'site-internal');
      const written = await writeUnifiedReportSite(files, internalRoot);
      expect(written).toEqual([join(internalRoot, 'internal/eval-reports/j-rig/index.html')]);
      expect(await readFile(written[0]!, 'utf8')).toContain('j-rig/unified-report/v1');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses the public site root before creating output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'iep-dashboard-public-refusal-'));
    try {
      await expect(
        writeUnifiedReportSite(generateUnifiedReportFiles(report()), join(root, 'site')),
      ).rejects.toThrow('refusing to write tailnet-only output');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
