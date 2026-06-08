/**
 * Live-pass tests — drives the verified worker over repos, persists gate-rows,
 * and records fresh/crashed outcomes for the renderer. Uses a passing + a
 * failing verifier (no real network) and in-memory stores.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJsonBytes, sha256Key } from './content-address.js';
import { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
import { MemoryGateRowStore } from './gate-row-store.js';
import { CachingManifestFetcher, runLivePass, type LivePassDeps } from './live-pass.js';
import { type ManifestFetcher, type SigstoreVerifier, VerifyFailure } from './interfaces.js';
import { type PinnedSubjects } from './oidc-allowlist.js';
import { type ReportManifest } from './manifest.js';
import { validEvidenceBundle } from './__fixtures__/bundle-fixtures.js';

const BUNDLE = validEvidenceBundle();
const BODY = { gate_name: 'coverage', gate_decision: 'pass', evaluated_at: '2026-06-08T00:00:00.000Z' };

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
      workflowRef: 'jeremylongshore/intent-eval-core/.github/workflows/release.yml@refs/tags/v0.3.1',
    },
    rows: [
      { bundle: BUNDLE, sigstoreBundle: {}, sourceSha: 'a'.repeat(40), gateResults: [BODY] } as never,
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
    expect(await d.gateRowStore.get(key)).toEqual({ repo: 'iec', bodies: [BODY] });
    // render input has a non-stale iec snapshot
    const iec = input.repos.find((r) => r.repo === 'iec');
    expect(iec?.snapshot?.bundleKeys).toContain(key);
    expect(iec?.staleSince).toBeUndefined();
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
