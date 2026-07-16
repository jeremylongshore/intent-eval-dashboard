/**
 * The 3 MANDATORY synthetic compromised-CI scenarios (DR-035 § 4.B / Epic 2.2).
 *
 * These prove the fail-closed / verify-before-render binding (CTO + CISO hard
 * refusal): a tampered/compromised input genuinely crashes the worker, the
 * staging snapshot is NOT replaced with unverified data, content-addressed
 * bundles survive a source SHA deletion, and one worker's crash does not affect
 * the other 7.
 *
 * Verification is the offline REAL-crypto verifier — the "compromise" really
 * breaks cryptography / the allowlist, not a flag.
 */

import { describe, expect, it } from 'vitest';
import { runIngestWorker, type IngestWorkerDeps } from './worker.js';
import { runDeployPass } from './tree.js';
import { runSupervisor } from '../supervision/index.js';
import { buildIngestSupervisorSpec } from './tree.js';
import { OfflineRowVerifier } from './verifier-offline.js';
import { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
import { Renderer, type RenderInput, type RenderSink } from './renderer.js';
import { Publisher } from './publisher.js';
import { NoopPublisherTransport } from './publisher-transport-noop.js';
import { isIngestCrash } from './reason.js';
import { canonicalJsonBytes, sha256Key } from './content-address.js';
import { type ManifestFetcher, type IngestClock } from './interfaces.js';
import { type ReportManifest } from './manifest.js';
import { type PinnedSubjects } from './oidc-allowlist.js';
import {
  REPO_GITHUB,
  mintManifest,
  mintRow,
  signingClaimsFor,
} from './__fixtures__/bundle-fixtures.js';

const clock: IngestClock = { nowIso: () => '2026-05-30T00:00:00.000Z', nowMs: () => 0 };

const PINNED: PinnedSubjects = {
  issuer: 'https://token.actions.githubusercontent.com',
  repos: Object.fromEntries(
    Object.entries(REPO_GITHUB).map(([repo, gh]) => [
      repo,
      {
        githubRepo: gh,
        subjects: [`repo:${gh}:ref:refs/tags/*`],
        workflowRefs: [`${gh}/.github/workflows/release.yml@refs/tags/*`],
        operatorConfirmed: true,
      },
    ]),
  ),
};

/** A recording render sink that captures the last render input. */
function recordingSink(): { sink: RenderSink; last: () => RenderInput | null } {
  let last: RenderInput | null = null;
  return {
    sink: {
      render: (input: RenderInput) => {
        last = input;
        return Promise.resolve();
      },
    },
    last: () => last,
  };
}

/** A per-repo fetcher backed by a map of manifests; unknown repos reject. */
function mapFetcher(manifests: Record<string, ReportManifest | Error>): ManifestFetcher {
  return {
    fetch: (repo: string) => {
      const m = manifests[repo];
      if (m === undefined) return Promise.reject(new Error(`no manifest for ${repo}`));
      if (m instanceof Error) return Promise.reject(m);
      return Promise.resolve(m);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — malicious manifest with wrong workflow_ref
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 1 — malicious manifest with wrong workflow_ref', () => {
  it('crashes at step 2; staging snapshot UNCHANGED; renderer serves the prior snapshot', async () => {
    const snapshotStore = new MemorySnapshotStore();
    const contentStore = new MemoryContentStore();

    // First, a CLEAN ingest establishes a prior good snapshot for iec.
    const cleanManifest = mintManifest('iec', REPO_GITHUB['iec']!);
    const cleanDeps: IngestWorkerDeps = {
      fetcher: mapFetcher({ iec: cleanManifest }),
      verifier: new OfflineRowVerifier(),
      contentStore,
      snapshotStore,
      clock: { nowIso: () => '2026-05-29T00:00:00.000Z', nowMs: () => 0 },
      pinned: PINNED,
    };
    const priorGood = await runIngestWorker('iec', cleanDeps);
    expect(await snapshotStore.get('iec')).toEqual(priorGood);

    // Now an ATTACKER publishes a manifest with a wrong workflow_ref.
    const evil = mintManifest('iec', REPO_GITHUB['iec']!);
    const evilManifest: ReportManifest = {
      ...evil,
      signing: {
        ...evil.signing,
        workflowRef:
          'jeremylongshore/intent-eval-core/.github/workflows/exfiltrate.yml@refs/heads/attacker',
      },
    };
    const evilDeps: IngestWorkerDeps = { ...cleanDeps, fetcher: mapFetcher({ iec: evilManifest }) };

    // The worker crashes at step 2 (fail-closed).
    let crashed = false;
    try {
      await runIngestWorker('iec', evilDeps);
    } catch (err: unknown) {
      crashed = true;
      expect(isIngestCrash(err)).toBe(true);
      if (isIngestCrash(err)) {
        expect(err.reason.step).toBe('verify_oidc');
        expect(err.reason.reasonCode).toBe('oidc_workflow_ref_mismatch');
      }
    }
    expect(crashed).toBe(true);

    // The staging snapshot is UNCHANGED — still the prior good one.
    const after = await snapshotStore.get('iec');
    expect(after).toEqual(priorGood);
    expect(after?.lastKnownGoodIngestedAt).toBe('2026-05-29T00:00:00.000Z');

    // The renderer, given the crashed outcome, serves the PRIOR snapshot with a
    // stale badge — never the unverified attacker input.
    const { sink, last } = recordingSink();
    const renderer = new Renderer(snapshotStore, sink);
    await renderer.render(
      [
        {
          repo: 'iec',
          fresh: false,
          failure: { step: 'verify_oidc', reasonCode: 'oidc_workflow_ref_mismatch' },
        },
      ],
      '2026-05-30T00:00:00.000Z',
    );
    const rendered = last();
    const iecRow = rendered?.repos.find((r) => r.repo === 'iec');
    expect(iecRow?.snapshot).toEqual(priorGood); // prior good, NOT the attacker's
    expect(iecRow?.staleSince).toBe('2026-05-29T00:00:00.000Z');
    expect(iecRow?.lastFailure?.reasonCode).toBe('oidc_workflow_ref_mismatch');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — valid manifest pointing at a force-pushed / deleted SHA
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 2 — force-pushed / deleted source SHA', () => {
  it('content-addressed bundle + deep link SURVIVE the source SHA deletion', async () => {
    const snapshotStore = new MemorySnapshotStore();
    const contentStore = new MemoryContentStore();

    // Ingest a bundle produced at source SHA "deadbeef...".
    const originalSha = 'd'.repeat(40);
    const row = mintRow('iec', REPO_GITHUB['iec']!, { sourceSha: originalSha });
    const manifest: ReportManifest = {
      repo: 'iec',
      signing: signingClaimsFor('iec', REPO_GITHUB['iec']!),
      rows: [row.row],
    };
    const deps: IngestWorkerDeps = {
      fetcher: mapFetcher({ iec: manifest }),
      verifier: new OfflineRowVerifier(),
      contentStore,
      snapshotStore,
      clock,
      pinned: PINNED,
    };
    const snapshot = await runIngestWorker('iec', deps);

    // The deep link is the CONTENT hash, computed independently here.
    const expectedKey = sha256Key(canonicalJsonBytes(row.row.bundle));
    expect(snapshot.bundleKeys[0]).toBe(expectedKey);

    // Simulate the source force-push / SHA deletion: the source repo no longer
    // serves anything at originalSha (the fetcher would now 404). Prove that the
    // dashboard can STILL retrieve the bundle by content hash from local store.
    const survivingFetcher = mapFetcher({
      iec: new Error(`source SHA ${originalSha} no longer exists (force-pushed)`),
    });
    // A re-ingest would fail (source gone)…
    await expect(
      runIngestWorker('iec', { ...deps, fetcher: survivingFetcher }),
    ).rejects.toBeInstanceOf(Error);

    // …but the deep link still resolves from content-addressed storage.
    const retrieved = await contentStore.get(expectedKey);
    expect(retrieved).not.toBeNull();
    // …and the retrieved bytes hash back to the same key (tamper-evident).
    expect(sha256Key(retrieved!)).toBe(expectedKey);
    // …and the prior snapshot (with the deep link) is still served.
    const stored = await snapshotStore.get('iec');
    expect(stored?.bundleKeys).toContain(expectedKey);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — network timeout on ONE worker; the other 7 unaffected
// ─────────────────────────────────────────────────────────────────────────────
describe('Scenario 3 — network timeout on one worker (transient isolation)', () => {
  it('the timed-out worker crashes + supervisor retries it; the other 7 are unaffected', async () => {
    const snapshotStore = new MemorySnapshotStore();
    const contentStore = new MemoryContentStore();

    // Establish a prior good snapshot for the repo that will time out (iah).
    const iahManifest = mintManifest('iah', REPO_GITHUB['iah']!);
    const priorDeps: IngestWorkerDeps = {
      fetcher: mapFetcher({ iah: iahManifest }),
      verifier: new OfflineRowVerifier(),
      contentStore,
      snapshotStore,
      clock: { nowIso: () => '2026-05-28T00:00:00.000Z', nowMs: () => 0 },
      pinned: PINNED,
    };
    const iahPrior = await runIngestWorker('iah', priorDeps);

    // Build manifests for all 8 repos — but iah's fetch TIMES OUT.
    const manifests: Record<string, ReportManifest | Error> = {};
    for (const [repo, gh] of Object.entries(REPO_GITHUB)) {
      manifests[repo] = mintManifest(repo, gh);
    }
    manifests['iah'] = new Error('ETIMEDOUT: manifest fetch timed out');

    const deps: IngestWorkerDeps = {
      fetcher: mapFetcher(manifests),
      verifier: new OfflineRowVerifier(),
      contentStore,
      snapshotStore,
      clock,
      pinned: PINNED,
    };

    const { sink, last } = recordingSink();
    const renderer = new Renderer(snapshotStore, sink);
    const publisher = new Publisher(new NoopPublisherTransport({ info: () => {} }));

    const result = await runDeployPass(deps, renderer, publisher, '/tmp/out');

    // iah crashed (timeout); the other 7 produced fresh snapshots.
    const iah = result.ingest.find((o) => o.repo === 'iah');
    expect(iah?.fresh).toBe(false);
    expect(iah?.failure?.step).toBe('fetch_manifest');
    for (const repo of ['iec', 'iel', 'iaj', 'iar', 'ccp', 'jrig', 'qmd']) {
      const outcome = result.ingest.find((o) => o.repo === repo);
      expect(outcome?.fresh).toBe(true);
    }

    // The renderer serves the 7 fresh snapshots + iah's PRIOR snapshot (stale).
    const rendered = last();
    const iahRow = rendered?.repos.find((r) => r.repo === 'iah');
    expect(iahRow?.snapshot).toEqual(iahPrior);
    expect(iahRow?.staleSince).toBe('2026-05-28T00:00:00.000Z');
    for (const repo of ['iec', 'iel', 'iaj', 'iar', 'ccp', 'jrig', 'qmd']) {
      const row = rendered?.repos.find((r) => r.repo === repo);
      expect(row?.snapshot?.lastKnownGoodIngestedAt).toBe('2026-05-30T00:00:00.000Z');
      expect(row?.staleSince).toBeUndefined();
    }

    // The publisher default is a no-op (production rsync is human-gated).
    expect(result.published.published).toBe(false);
  });

  it('supervisor RETRIES the transient timed-out worker, then escalates if it keeps timing out', async () => {
    // Drive the ingest_supervisor directly to prove transient RESTART of the
    // crashed worker, isolated from the others. iah always times out; the
    // supervisor restarts it up to its budget then escalates (no infinite loop);
    // the other workers run exactly once.
    const runCounts: Record<string, number> = {};
    const runWorker = (repo: string): Promise<unknown> => {
      runCounts[repo] = (runCounts[repo] ?? 0) + 1;
      if (repo === 'iah') {
        return Promise.reject(new Error('ETIMEDOUT'));
      }
      return Promise.resolve();
    };
    const spec = buildIngestSupervisorSpec(runWorker, ['iec', 'iah', 'iel'], {
      maxRestarts: 2,
      periodMs: 10_000,
    });
    let t = 0;
    const report = await runSupervisor(spec, { now: () => ++t });

    // iah: initial + 2 restarts = 3 runs, then escalate.
    expect(runCounts['iah']).toBe(3);
    expect(report.escalations.map((e) => e.childId)).toEqual(['ingest_worker:iah']);
    // The other two ran exactly once — fully isolated (one_for_one).
    expect(runCounts['iec']).toBe(1);
    expect(runCounts['iel']).toBe(1);
    expect(report.runCounts.get('ingest_worker:iec')).toBe(1);
    expect(report.runCounts.get('ingest_worker:iel')).toBe(1);
  });
});
