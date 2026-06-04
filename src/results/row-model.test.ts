/**
 * Results view-model + production bundle-resolver tests.
 *
 * Covers:
 *   - buildRepoResults: rows flatten in (bundle, row) order; no-data when no
 *     snapshot / empty keys / unresolvable keys; staleSince + ingestedAt carry
 *     through; the 4-timestamp surface is populated; visibility defaults fail
 *     closed to Tier 2.
 *   - buildResultsView: asOf = min(ingested_at) across repos that have snapshots.
 *   - ContentStoreBundleResolver: re-validates the EvidenceBundle against the
 *     kernel; pairs it with gate rows; drops projections whose predicate URI the
 *     bundle never claimed; returns null for absent / invalid / unparseable keys.
 */

import { describe, expect, it } from 'vitest';
import { MemoryContentStore } from '../ingest/storage-memory.js';
import { ContentStoreBundleResolver } from './bundle-resolver.js';
import { buildRepoResults, buildResultsView } from './row-model.js';
import {
  FixtureGateRowSource,
  FixtureResolver,
  GATE_RESULT_URI,
  VALIDATION_URI,
  keyFor,
  renderInput,
  repoState,
  resolvedRow,
  storeBundle,
  validBundle,
} from './__fixtures__/results-fixtures.js';

describe('buildRepoResults', () => {
  it('flattens rows across bundle keys in (bundle, row) order', async () => {
    const k1 = 'sha256:' + '1'.repeat(64);
    const k2 = 'sha256:' + '2'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([
        [k1, [resolvedRow({ gateName: 'a' }), resolvedRow({ gateName: 'b' })]],
        [k2, [resolvedRow({ gateName: 'c' })]],
      ]),
    );
    const result = await buildRepoResults(
      repoState('iec', { bundleKeys: [k1, k2], ingestedAt: '2026-05-30T12:00:05.000Z' }),
      resolver,
    );
    expect(result.noData).toBe(false);
    expect(result.rows.map((r) => r.gateName)).toEqual(['a', 'b', 'c']);
    expect(result.rows.map((r) => r.rowIndex)).toEqual([0, 1, 0]);
    expect(result.rows[0]?.bundleKey).toBe(k1);
    expect(result.rows[2]?.bundleKey).toBe(k2);
  });

  it('populates the 4-timestamp surface (never collapsed)', async () => {
    const k = 'sha256:' + '3'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([
        [
          k,
          [
            resolvedRow({
              evaluatedAt: '2026-05-30T11:00:00.000Z',
              bundleCreatedAt: '2026-05-30T11:30:00.000Z',
              rekorLogIndices: [42, 43],
            }),
          ],
        ],
      ]),
    );
    const r = (
      await buildRepoResults(
        repoState('iec', { bundleKeys: [k], ingestedAt: '2026-05-30T12:00:05.000Z' }),
        resolver,
      )
    ).rows[0]!;
    expect(r.evaluatedAt).toBe('2026-05-30T11:00:00.000Z');
    expect(r.bundleCreatedAt).toBe('2026-05-30T11:30:00.000Z');
    expect(r.rekorLogIndices).toEqual([42, 43]);
    expect(r.ingestedAt).toBe('2026-05-30T12:00:05.000Z');
    // All four are distinct values — proving they are not collapsed.
    expect(new Set([r.evaluatedAt, r.bundleCreatedAt, String(r.rekorLogIndices), r.ingestedAt]).size).toBe(4);
  });

  it('is no-data with a null snapshot', async () => {
    const resolver = new FixtureResolver(new Map());
    const r = await buildRepoResults(repoState('iel', { nullSnapshot: true }), resolver);
    expect(r.noData).toBe(true);
    expect(r.rows).toEqual([]);
    expect(r.ingestedAt).toBeUndefined();
  });

  it('is no-data with an empty bundleKeys snapshot', async () => {
    const resolver = new FixtureResolver(new Map());
    const r = await buildRepoResults(repoState('iah', { bundleKeys: [] }), resolver);
    expect(r.noData).toBe(true);
    expect(r.rows).toEqual([]);
  });

  it('is no-data when every key is unresolvable (hole, not a pass)', async () => {
    const resolver = new FixtureResolver(new Map()); // resolves nothing
    const r = await buildRepoResults(
      repoState('iaj', { bundleKeys: ['sha256:' + 'f'.repeat(64)] }),
      resolver,
    );
    expect(r.noData).toBe(true);
    expect(r.rows).toEqual([]);
  });

  it('carries staleSince through', async () => {
    const resolver = new FixtureResolver(new Map());
    const r = await buildRepoResults(
      repoState('iar', { nullSnapshot: true, staleSince: '2026-05-29T00:00:00.000Z' }),
      resolver,
    );
    expect(r.staleSince).toBe('2026-05-29T00:00:00.000Z');
  });

  it('defaults a row with NO visibility to Tier 2 (fail closed)', async () => {
    const k = 'sha256:' + '7'.repeat(64);
    // resolvedRow with visibility coerced to undefined
    const rows = [{ ...resolvedRow(), visibility: undefined as never }];
    const resolver = new FixtureResolver(new Map([[k, rows]]));
    const r = (await buildRepoResults(repoState('iec', { bundleKeys: [k] }), resolver)).rows[0]!;
    expect(r.visibility.tier).toBe('tier-2');
  });

  it('coerces an unknown tier string to Tier 2 (fail closed)', async () => {
    const k = 'sha256:' + '8'.repeat(64);
    const rows = [{ ...resolvedRow(), visibility: { tier: 'tier-bogus' } as never }];
    const resolver = new FixtureResolver(new Map([[k, rows]]));
    const r = (await buildRepoResults(repoState('iec', { bundleKeys: [k] }), resolver)).rows[0]!;
    expect(r.visibility.tier).toBe('tier-2');
  });

  it('preserves consent + embargo annotations', async () => {
    const k = 'sha256:' + '9'.repeat(64);
    const rows = [
      {
        ...resolvedRow(),
        visibility: { tier: 'tier-2' as const, consent: true, embargoUntil: '2026-07-01T00:00:00Z' },
      },
    ];
    const resolver = new FixtureResolver(new Map([[k, rows]]));
    const v = (await buildRepoResults(repoState('iec', { bundleKeys: [k] }), resolver)).rows[0]!.visibility;
    expect(v).toEqual({ tier: 'tier-2', consent: true, embargoUntil: '2026-07-01T00:00:00Z' });
  });
});

describe('buildResultsView', () => {
  it('sets asOf = min(ingested_at) across repos with snapshots', async () => {
    const k = 'sha256:' + 'a'.repeat(64);
    const resolver = new FixtureResolver(new Map([[k, [resolvedRow()]]]));
    const input = renderInput([
      repoState('iec', { bundleKeys: [k], ingestedAt: '2026-05-30T12:00:05.000Z' }),
      repoState('iel', { bundleKeys: [k], ingestedAt: '2026-05-30T09:00:00.000Z' }), // oldest
      repoState('iah', { nullSnapshot: true }), // no snapshot — excluded from min
    ]);
    const view = await buildResultsView(input, resolver);
    expect(view.asOf).toBe('2026-05-30T09:00:00.000Z');
    expect(view.repos).toHaveLength(3);
  });

  it('leaves asOf undefined when no repo has a snapshot', async () => {
    const resolver = new FixtureResolver(new Map());
    const input = renderInput([repoState('iec', { nullSnapshot: true })]);
    const view = await buildResultsView(input, resolver);
    expect(view.asOf).toBeUndefined();
    expect(view.repos[0]?.noData).toBe(true);
  });
});

describe('ContentStoreBundleResolver', () => {
  it('resolves a kernel-valid bundle paired with its gate rows', async () => {
    const store = new MemoryContentStore();
    const bundle = validBundle();
    const key = await storeBundle(store, bundle);
    expect(key).toBe(keyFor(bundle));

    const gateRows = new FixtureGateRowSource(
      new Map([
        [
          key,
          [
            {
              predicateUri: GATE_RESULT_URI,
              decision: 'pass' as const,
              gateName: 'escape-scan',
              evaluatedAt: '2026-05-30T11:59:00.000Z',
              visibility: { tier: 'tier-1' as const },
            },
          ],
        ],
      ]),
    );
    const resolver = new ContentStoreBundleResolver(store, gateRows);
    const rows = await resolver.resolve(key);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows![0]?.predicateUri).toBe(GATE_RESULT_URI);
    expect(rows![0]?.bundleCreatedAt).toBe(bundle['created_at']);
    expect(rows![0]?.rekorLogIndices).toEqual([1689291334]);
  });

  it('returns null for an absent key (no-data hole)', async () => {
    const store = new MemoryContentStore();
    const resolver = new ContentStoreBundleResolver(store, new FixtureGateRowSource(new Map()));
    expect(await resolver.resolve('sha256:' + 'd'.repeat(64))).toBeNull();
  });

  it('returns null when the bytes fail kernel validation', async () => {
    const store = new MemoryContentStore();
    // store invalid bundle bytes (missing required fields)
    const key = await storeBundle(store, { id: 'not-a-uuid' });
    const resolver = new ContentStoreBundleResolver(
      store,
      new FixtureGateRowSource(new Map([[key, [{ predicateUri: GATE_RESULT_URI, decision: 'pass', gateName: 'x', evaluatedAt: 'z', visibility: { tier: 'tier-1' } }]]])),
    );
    expect(await resolver.resolve(key)).toBeNull();
  });

  it('returns null when the bytes are not JSON', async () => {
    const store = new MemoryContentStore();
    const key = await store.put(new TextEncoder().encode('{not json'));
    const resolver = new ContentStoreBundleResolver(store, new FixtureGateRowSource(new Map()));
    expect(await resolver.resolve(key)).toBeNull();
  });

  it('drops a projection whose predicate URI the bundle never claimed', async () => {
    const store = new MemoryContentStore();
    const bundle = validBundle(); // predicate_uri_set = [GATE_RESULT_URI] only
    const key = await storeBundle(store, bundle);
    const gateRows = new FixtureGateRowSource(
      new Map([
        [
          key,
          [
            { predicateUri: GATE_RESULT_URI, decision: 'pass', gateName: 'kept', evaluatedAt: 'z', visibility: { tier: 'tier-1' } },
            { predicateUri: VALIDATION_URI, decision: 'pass', gateName: 'dropped', evaluatedAt: 'z', visibility: { tier: 'tier-1' } },
          ],
        ],
      ]),
    );
    const resolver = new ContentStoreBundleResolver(store, gateRows);
    const rows = await resolver.resolve(key);
    expect(rows).toHaveLength(1);
    expect(rows![0]?.gateName).toBe('kept');
  });

  it('returns null when gate rows are absent for a valid bundle', async () => {
    const store = new MemoryContentStore();
    const key = await storeBundle(store, validBundle());
    const resolver = new ContentStoreBundleResolver(store, new FixtureGateRowSource(new Map()));
    expect(await resolver.resolve(key)).toBeNull();
  });
});
