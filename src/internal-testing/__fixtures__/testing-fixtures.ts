/**
 * Test fixtures for the internal-testing (teaching dashboard) module.
 *
 * Provides:
 *   - a builder for the richer {@link ResolvedTestingRow} projection;
 *   - a map-backed {@link TestingBundleResolver};
 *   - a small in-memory {@link ExplainerSet};
 * and re-exports the RenderInput/RenderRepoState helpers from the results
 * fixtures (the upstream verified seam is shared).
 */

import {
  type ResolvedTestingRow,
  type TestingBundleResolver,
  type TestingRow,
} from '../testing-row.js';
import { type ExplainerDoc, type ExplainerSet } from '../explainers.js';

export { renderInput, repoState } from '../../results/__fixtures__/results-fixtures.js';

export const GATE_RESULT_URI = 'https://evals.intentsolutions.io/gate-result/v1';
export const VALIDATION_URI = 'https://evals.intentsolutions.io/validation-result/v1';

/** Build a richer gate-result/v1 testing-row projection (overridable per test). */
export function resolvedTestingRow(
  opts: Partial<ResolvedTestingRow> = {},
): ResolvedTestingRow {
  return {
    predicateUri: opts.predicateUri ?? GATE_RESULT_URI,
    gateId: opts.gateId ?? 'intent-eval-core:ci:coverage',
    gateName: opts.gateName ?? 'coverage',
    gateVersion: opts.gateVersion ?? '1.0.0',
    decision: opts.decision ?? 'pass',
    gateReasons: opts.gateReasons ?? [],
    coverage: opts.coverage ?? {
      dimensionsEvaluated: ['lines', 'branches', 'functions', 'statements'],
      dimensionsSkipped: [],
    },
    evaluatedAt: opts.evaluatedAt ?? '2026-05-30T11:59:00.000Z',
    bundleCreatedAt: opts.bundleCreatedAt ?? '2026-05-30T12:00:00.000Z',
    rekorLogIndices: opts.rekorLogIndices ?? [1689291334],
    ...(opts.failureMode !== undefined ? { failureMode: opts.failureMode } : {}),
    ...(opts.advisorySeverity !== undefined ? { advisorySeverity: opts.advisorySeverity } : {}),
  };
}

/** Build a full renderable {@link TestingRow} (resolved projection + identity). */
export function testingRow(opts: Partial<TestingRow> = {}): TestingRow {
  return {
    ...resolvedTestingRow(opts),
    repo: opts.repo ?? 'iec',
    bundleKey: opts.bundleKey ?? 'sha256:' + 'a'.repeat(64),
    rowIndex: opts.rowIndex ?? 0,
    ingestedAt: opts.ingestedAt ?? '2026-05-30T12:00:05.000Z',
  };
}

/** A map-backed resolver: bundleKey → rows; absent keys resolve to null. */
export class TestingFixtureResolver implements TestingBundleResolver {
  constructor(private readonly map: Map<string, readonly ResolvedTestingRow[]>) {}
  resolve(bundleKey: string): Promise<readonly ResolvedTestingRow[] | null> {
    return Promise.resolve(this.map.get(bundleKey) ?? null);
  }
}

/** Build a small in-memory ExplainerSet for render tests (no filesystem). */
export function explainerSet(
  docs: readonly Partial<ExplainerDoc>[] = [],
): ExplainerSet {
  const map = new Map<string, ExplainerDoc>();
  for (const d of docs) {
    const key = d.key ?? 'gate-result';
    map.set(key, {
      key,
      title: d.title ?? key,
      html: d.html ?? `            <p>Explainer for ${key}.</p>`,
    });
  }
  return map;
}
