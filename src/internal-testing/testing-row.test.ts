/**
 * Testing view-model tests.
 *
 * Proves the verify-before-render projection: a null snapshot, an empty
 * bundle-key list, or an unresolvable key all yield a loud no-data state (never
 * a synthetic pass); resolved rows are flattened with stable repo/bundle/row
 * identity; and the view's `asOf` is the min(ingested_at) staleness floor.
 */

import { describe, expect, it } from 'vitest';
import { type RenderInput, type RenderRepoState } from '../ingest/renderer.js';
import { type IngestSnapshot } from '../ingest/interfaces.js';
import { buildTestingRepo, buildTestingView } from './testing-row.js';
import {
  TestingFixtureResolver,
  renderInput,
  repoState,
  resolvedTestingRow,
} from './__fixtures__/testing-fixtures.js';

const KA = 'sha256:' + 'a'.repeat(64);
const KB = 'sha256:' + 'b'.repeat(64);

describe('buildTestingRepo — no-data is never a pass', () => {
  it('null snapshot → noData, zero rows', async () => {
    const repo = await buildTestingRepo(
      repoState('iec', { nullSnapshot: true }),
      new TestingFixtureResolver(new Map()),
    );
    expect(repo.noData).toBe(true);
    expect(repo.rows).toEqual([]);
  });

  it('empty bundle-key list → noData', async () => {
    const repo = await buildTestingRepo(
      repoState('iec', { bundleKeys: [] }),
      new TestingFixtureResolver(new Map()),
    );
    expect(repo.noData).toBe(true);
  });

  it('unresolvable key → hole, not a pass', async () => {
    const repo = await buildTestingRepo(
      repoState('iec', { bundleKeys: [KA] }),
      new TestingFixtureResolver(new Map()), // KA absent → resolve returns null
    );
    expect(repo.noData).toBe(true);
    expect(repo.rows).toEqual([]);
  });
});

describe('buildTestingRepo — resolved rows', () => {
  it('flattens rows across bundles with stable repo/bundle/row identity', async () => {
    const resolver = new TestingFixtureResolver(
      new Map([
        [KA, [resolvedTestingRow({ gateName: 'coverage' }), resolvedTestingRow({ gateName: 'crap' })]],
        [KB, [resolvedTestingRow({ gateName: 'architecture' })]],
      ]),
    );
    const repo = await buildTestingRepo(
      repoState('iec', { bundleKeys: [KA, KB], ingestedAt: '2026-05-30T12:00:09.000Z' }),
      resolver,
    );
    expect(repo.noData).toBe(false);
    expect(repo.rows.map((r) => r.gateName)).toEqual(['coverage', 'crap', 'architecture']);
    expect(repo.rows.map((r) => r.rowIndex)).toEqual([0, 1, 0]);
    expect(repo.rows.map((r) => r.bundleKey)).toEqual([KA, KA, KB]);
    expect(repo.rows.every((r) => r.repo === 'iec')).toBe(true);
    expect(repo.rows.every((r) => r.ingestedAt === '2026-05-30T12:00:09.000Z')).toBe(true);
  });

  it('propagates staleSince', async () => {
    const resolver = new TestingFixtureResolver(new Map([[KA, [resolvedTestingRow()]]]));
    const repo = await buildTestingRepo(
      repoState('iel', { bundleKeys: [KA], staleSince: '2026-05-29T00:00:00.000Z' }),
      resolver,
    );
    expect(repo.staleSince).toBe('2026-05-29T00:00:00.000Z');
  });

  it('defends against a snapshot missing ingested-at (empty string, key omitted)', async () => {
    const resolver = new TestingFixtureResolver(new Map([[KA, [resolvedTestingRow()]]]));
    // A malformed snapshot with no lastKnownGoodIngestedAt — type-hole exercise.
    const badSnapshot = {
      repo: 'iec',
      sourceSha: 'a'.repeat(40),
      bundleKeys: [KA],
    } as unknown as IngestSnapshot;
    const state: RenderRepoState = { repo: 'iec', snapshot: badSnapshot };
    const repo = await buildTestingRepo(state, resolver);
    expect(repo.rows[0]?.ingestedAt).toBe('');
    expect(repo.ingestedAt).toBeUndefined();
  });
});

describe('buildTestingView', () => {
  it('asOf = min(ingested_at) across repos that have a snapshot', async () => {
    const resolver = new TestingFixtureResolver(new Map([[KA, [resolvedTestingRow()]]]));
    const input: RenderInput = renderInput([
      repoState('iec', { bundleKeys: [KA], ingestedAt: '2026-05-30T12:00:09.000Z' }),
      repoState('iel', { bundleKeys: [KA], ingestedAt: '2026-05-30T11:00:00.000Z' }),
      repoState('iah', { nullSnapshot: true }),
    ]);
    const view = await buildTestingView(input, resolver);
    expect(view.asOf).toBe('2026-05-30T11:00:00.000Z');
    expect(view.repos.map((r) => r.repo)).toEqual(['iec', 'iel', 'iah']);
  });

  it('asOf undefined when no repo has a snapshot', async () => {
    const input: RenderInput = renderInput([
      repoState('iec', { nullSnapshot: true }),
      repoState('iel', { nullSnapshot: true }),
    ]);
    const view = await buildTestingView(input, new TestingFixtureResolver(new Map()));
    expect(view.asOf).toBeUndefined();
    expect(view.repos.every((r) => r.noData)).toBe(true);
  });
});
