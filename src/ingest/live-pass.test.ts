/**
 * Live-pass tests — drives the verified worker over repos, persists gate-rows,
 * and records fresh/crashed outcomes for the renderer. Uses a passing + a
 * failing verifier (no real network) and in-memory stores.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJsonBytes, sha256Key } from './content-address.js';
import { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
import { FsGateRowStore, MemoryGateRowStore } from './gate-row-store.js';
import { CachingManifestFetcher, runLivePass, type LivePassDeps } from './live-pass.js';
import { type ManifestFetcher, type SigstoreVerifier, VerifyFailure } from './interfaces.js';
import { type PinnedSubjects } from './oidc-allowlist.js';
import { type ReportManifest } from './manifest.js';
import { restartPressure } from '../freshness/restart-pressure.js';
import { validEvidenceBundle, validGateResult } from './__fixtures__/bundle-fixtures.js';

const BODY = validGateResult();
const BUNDLE = validEvidenceBundle(BODY);

const PINNED: PinnedSubjects = {
  issuer: 'https://token.actions.githubusercontent.com',
  repos: {
    iec: {
      githubRepo: 'jeremylongshore/intent-eval-core',
      subjects: ['repo:jeremylongshore/intent-eval-core:ref:refs/tags/*'],
      workflowRefs: ['jeremylongshore/intent-eval-core/.github/workflows/release.yml@refs/tags/*'],
      operatorConfirmed: true,
    },
  },
};

function iecManifest(): ReportManifest {
  return {
    repo: 'iec',
    signing: {
      issuer: 'https://token.actions.githubusercontent.com',
      subject: 'repo:jeremylongshore/intent-eval-core:ref:refs/tags/v0.3.1',
      workflowRef:
        'jeremylongshore/intent-eval-core/.github/workflows/release.yml@refs/tags/v0.3.1',
    },
    rows: [
      {
        bundle: BUNDLE,
        sigstoreBundle: {},
        sourceSha: 'a'.repeat(40),
        gateResults: [BODY],
      },
    ],
  };
}

function iecMultiRowManifest(): ReportManifest {
  const secondBody = {
    ...validGateResult(),
    gate_id: 'j-rig:ci:gate-8-layer',
    gate_name: 'gate-8-layer',
    input_hash: `sha256:${'e'.repeat(64)}`,
  };
  return {
    ...iecManifest(),
    rows: [
      ...iecManifest().rows,
      {
        bundle: validEvidenceBundle(secondBody),
        sigstoreBundle: {},
        sourceSha: 'b'.repeat(40),
        gateResults: [secondBody],
      },
    ],
  };
}

const PASS_VERIFIER: SigstoreVerifier = { verifyRow: () => Promise.resolve() };
const FAIL_VERIFIER: SigstoreVerifier = {
  verifyRow: () => Promise.reject(new VerifyFailure('dsse_signature', 'bad sig')),
};

function deps(fetcher: ManifestFetcher, verifier: SigstoreVerifier): LivePassDeps {
  return {
    fetcher,
    verifier,
    contentStore: new MemoryContentStore(),
    snapshotStore: new MemorySnapshotStore(),
    gateRowStore: new MemoryGateRowStore(),
    clock: { nowIso: () => '2026-06-08T00:00:05.000Z', nowMs: () => 1780531205000 },
    pinned: PINNED,
  };
}

const OK_FETCHER: ManifestFetcher = {
  fetch: (repo) =>
    repo === 'iec' ? Promise.resolve(iecManifest()) : Promise.reject(new Error('404 not found')),
};

describe('runLivePass — verified repo', () => {
  it('marks iec fresh, snapshots it, and persists its gate-result bodies', async () => {
    const d = deps(OK_FETCHER, PASS_VERIFIER);
    const { input, outcomes } = await runLivePass(d, ['iec']);

    expect(outcomes).toEqual([{ repo: 'iec', fresh: true }]);
    // gate-rows persisted under the row's bundle content key
    const key = sha256Key(canonicalJsonBytes(BUNDLE));
    // `sigstoreBundle: {}` in this fixture carries no transparency-log entry, so
    // the recorded Rekor anchor is honestly EMPTY — not fabricated.
    expect(await d.gateRowStore.get(key, 'iec')).toEqual({
      repo: 'iec',
      bodies: [BODY],
      rekorLogIndices: [],
    });
    // render input has a non-stale iec snapshot
    const iec = input.repos.find((r) => r.repo === 'iec');
    expect(iec?.snapshot?.bundleKeys).toContain(key);
    expect(iec?.staleSince).toBeUndefined();
  });

  it('persists every uniquely addressed row in a multi-row producer manifest', async () => {
    const manifest = iecMultiRowManifest();
    const d = deps({ fetch: () => Promise.resolve(manifest) }, PASS_VERIFIER);
    const { input, outcomes } = await runLivePass(d, ['iec']);

    expect(outcomes).toEqual([{ repo: 'iec', fresh: true }]);
    const keys = manifest.rows.map((row) => sha256Key(canonicalJsonBytes(row.bundle)));
    expect(new Set(keys).size).toBe(2);
    expect(input.repos[0]?.snapshot?.bundleKeys).toEqual(keys);
    for (let i = 0; i < keys.length; i++) {
      expect(await d.gateRowStore.get(keys[i]!, 'iec')).toEqual({
        repo: 'iec',
        bodies: manifest.rows[i]!.gateResults,
        rekorLogIndices: [],
      });
    }
  });
});

describe('runLivePass — fail-closed', () => {
  it('records a repo whose manifest is unreachable as not-fresh', async () => {
    const { outcomes } = await runLivePass(deps(OK_FETCHER, PASS_VERIFIER), ['iel']);
    expect(outcomes[0]?.fresh).toBe(false);
    expect(outcomes[0]?.failure?.step).toBe('fetch_manifest');
  });

  it('records a repo whose signature fails verification as not-fresh', async () => {
    const { outcomes } = await runLivePass(deps(OK_FETCHER, FAIL_VERIFIER), ['iec']);
    expect(outcomes[0]?.fresh).toBe(false);
    expect(outcomes[0]?.failure?.step).toBe('verify_dsse_signature');
  });

  it('does not persist a predicate body whose signed binding is invalid', async () => {
    const manifest = iecManifest();
    const body = manifest.rows[0]!.gateResults![0] as Record<string, unknown>;
    const tampered: ReportManifest = {
      ...manifest,
      rows: [
        {
          ...manifest.rows[0]!,
          gateResults: [{ ...body, gate_decision: 'fail', gate_reasons: ['tampered'] }],
        },
      ],
    };
    const store = new MemoryGateRowStore();
    const d = {
      ...deps({ fetch: () => Promise.resolve(tampered) }, PASS_VERIFIER),
      gateRowStore: store,
    };
    const { outcomes } = await runLivePass(d, ['iec']);

    expect(outcomes[0]?.fresh).toBe(false);
    const key = sha256Key(canonicalJsonBytes(BUNDLE));
    expect(await store.get(key, 'iec')).toBeNull();
    expect(await d.snapshotStore.get('iec')).toBeNull();
    expect(await d.contentStore.has(key)).toBe(false);
  });

  it('rejects an entire multi-row snapshot before writing any sidecar if one row is invalid', async () => {
    const manifest = iecMultiRowManifest();
    const second = manifest.rows[1]!;
    const secondBody = second.gateResults![0] as Record<string, unknown>;
    const tampered: ReportManifest = {
      ...manifest,
      rows: [
        manifest.rows[0]!,
        {
          ...second,
          gateResults: [{ ...secondBody, gate_decision: 'fail', gate_reasons: ['tampered'] }],
        },
      ],
    };
    const d = deps({ fetch: () => Promise.resolve(tampered) }, PASS_VERIFIER);
    const { outcomes } = await runLivePass(d, ['iec']);

    expect(outcomes[0]?.fresh).toBe(false);
    expect(await d.snapshotStore.get('iec')).toBeNull();
    for (const row of manifest.rows) {
      const key = sha256Key(canonicalJsonBytes(row.bundle));
      expect(await d.gateRowStore.get(key, 'iec')).toBeNull();
    }
  });

  it('keeps the prior snapshot authoritative when bound-row persistence fails', async () => {
    const base = deps(OK_FETCHER, PASS_VERIFIER);
    const prior = {
      repo: 'iec',
      lastKnownGoodIngestedAt: '2026-06-07T00:00:00.000Z',
      sourceSha: 'f'.repeat(40),
      bundleKeys: [`sha256:${'f'.repeat(64)}`],
    };
    await base.snapshotStore.put(prior);
    const d: LivePassDeps = {
      ...base,
      gateRowStore: {
        put: () => Promise.reject(new Error('simulated disk failure')),
        get: () => Promise.resolve(null),
      },
    };
    const { outcomes } = await runLivePass(d, ['iec']);

    expect(outcomes[0]).toMatchObject({
      repo: 'iec',
      fresh: false,
      failure: { step: 'emit_snapshot', reasonCode: 'gate_row_emit_failed' },
    });
    expect(await d.snapshotStore.get('iec')).toEqual(prior);
  });
});

describe('CachingManifestFetcher', () => {
  it('caches the last manifest per repo and only hits the inner fetcher once', async () => {
    let calls = 0;
    const inner: ManifestFetcher = {
      fetch: (repo) => {
        calls += 1;
        return Promise.resolve({ ...iecManifest(), repo });
      },
    };
    const cf = new CachingManifestFetcher(inner);
    await cf.fetch('iec');
    expect(cf.cached('iec')?.repo).toBe('iec');
    expect(cf.cached('nope')).toBeUndefined();
    expect(calls).toBe(1);
  });
});

describe('live collector restart telemetry', () => {
  it('keeps uninstrumented failures unknown and does not retry', async () => {
    let calls = 0;
    const d = deps(
      {
        fetch: async () => {
          calls++;
          throw new Error('offline');
        },
      },
      PASS_VERIFIER,
    );
    const result = await runLivePass(d, ['iec']);
    expect(calls).toBe(1);
    expect(result.supervision).toBeUndefined();
    expect(restartPressure(result.supervision, 1)).toEqual({
      measured: false,
      restartCount: 0,
      restartBudget: 3,
      escalatedChildIds: [],
    });
    expect(result.outcomes[0]?.fresh).toBe(false);
  });

  it('records a real retry, then renders only the successfully verified attempt', async () => {
    let calls = 0;
    const d = deps(
      {
        fetch: async () => {
          if (++calls === 1) throw new Error('transient fetch failure');
          return iecManifest();
        },
      },
      PASS_VERIFIER,
    );
    const result = await runLivePass(d, ['iec'], {
      supervised: true,
      supervisorClock: { now: () => 0 },
    });
    expect(calls).toBe(2);
    expect(result.supervision?.runCounts.get('ingest_worker:iec')).toBe(2);
    expect(restartPressure(result.supervision, 1)).toEqual({
      measured: true,
      restartCount: 1,
      restartBudget: 3,
      escalatedChildIds: [],
    });
    expect(result.outcomes).toEqual([{ repo: 'iec', fresh: true }]);
    expect(result.input.repos[0]?.snapshot?.bundleKeys).toContain(
      sha256Key(canonicalJsonBytes(BUNDLE)),
    );
    expect(result.input.repos[0]?.staleSince).toBeUndefined();
  });

  it('reports exhaustion without publishing an unverified snapshot or gate row', async () => {
    let calls = 0;
    const d = deps(
      {
        fetch: async () => {
          calls++;
          return iecManifest();
        },
      },
      FAIL_VERIFIER,
    );
    const result = await runLivePass(d, ['iec'], {
      supervised: true,
      supervisorClock: { now: () => 0 },
    });
    expect(calls).toBe(4);
    expect(restartPressure(result.supervision, 1)).toEqual({
      measured: true,
      restartCount: 3,
      restartBudget: 3,
      escalatedChildIds: ['ingest_worker:iec'],
    });
    expect(result.outcomes[0]?.fresh).toBe(false);
    expect(result.outcomes[0]?.failure?.step).toBe('verify_dsse_signature');
    expect(result.input.repos[0]?.snapshot).toBeNull();
    expect(await d.gateRowStore.get(sha256Key(canonicalJsonBytes(BUNDLE)), 'iec')).toBeNull();
  });

  it('records measured zero for a clean supervised pass and isolates failed siblings', async () => {
    const clean = await runLivePass(deps(OK_FETCHER, PASS_VERIFIER), ['iec'], { supervised: true });
    expect(restartPressure(clean.supervision, 1)).toEqual({
      measured: true,
      restartCount: 0,
      restartBudget: 3,
      escalatedChildIds: [],
    });
    const mixedDeps = deps(OK_FETCHER, PASS_VERIFIER);
    const mixed = await runLivePass(mixedDeps, ['iec', 'iel'], {
      supervised: true,
      supervisorClock: { now: () => 0 },
    });
    expect(mixed.supervision?.runCounts.get('ingest_worker:iec')).toBe(1);
    expect(mixed.supervision?.runCounts.get('ingest_worker:iel')).toBe(4);
    expect(mixed.outcomes.map((o) => [o.repo, o.fresh])).toEqual([
      ['iec', true],
      ['iel', false],
    ]);
    expect(restartPressure(mixed.supervision, 2).escalatedChildIds).toEqual(['ingest_worker:iel']);
    const key = sha256Key(canonicalJsonBytes(BUNDLE));
    expect(mixed.input.repos[0]?.snapshot?.bundleKeys).toContain(key);
    expect(mixed.input.repos[0]?.staleSince).toBeUndefined();
    expect(await mixedDeps.gateRowStore.get(key, 'iec')).toMatchObject({
      repo: 'iec',
      bodies: [BODY],
    });
    expect(await mixedDeps.snapshotStore.get('iel')).toBeNull();
  });
});

it('serializes real filesystem writes when verified repos share a bundle key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dashboard-supervision-'));
  try {
    const store = new FsGateRowStore(root);
    let active = 0;
    let peak = 0;
    const written: string[] = [];
    const d = deps({ fetch: async (repo) => ({ ...iecManifest(), repo }) }, PASS_VERIFIER);
    const result = await runLivePass(
      {
        ...d,
        pinned: { ...PINNED, repos: { ...PINNED.repos, iel: PINNED.repos['iec']! } },
        gateRowStore: {
          get: (key, repo) => store.get(key, repo),
          put: async (key, rows) => {
            active++;
            peak = Math.max(peak, active);
            try {
              await store.put(key, rows);
              expect(await store.get(key, rows.repo)).toEqual(rows);
              written.push(rows.repo);
            } finally {
              active--;
            }
          },
        },
      },
      ['iec', 'iel'],
      { supervised: true },
    );
    expect(result.outcomes).toEqual([
      { repo: 'iec', fresh: true },
      { repo: 'iel', fresh: true },
    ]);
    expect(peak).toBe(1);
    expect(written).toEqual(['iec', 'iel']);
    const key = sha256Key(canonicalJsonBytes(BUNDLE));
    expect(await store.get(key, 'iec')).toMatchObject({ repo: 'iec', bodies: [BODY] });
    expect(await store.get(key, 'iel')).toMatchObject({ repo: 'iel', bodies: [BODY] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
