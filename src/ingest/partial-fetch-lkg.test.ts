/**
 * Partial-fetch last-known-good proof (bead nr75.17).
 *
 * The blackout-guard in regenerate.yml (PR dashboard#26) catches a TOTAL
 * manifest-fetch blackout (0 repos verify → retry → skip commit/deploy). It does
 * NOT cover a PARTIAL failure (e.g. 2 of 4 verify): the run proceeds, and the
 * unfetched repos would regress to no-data IF the ingest store were ephemeral.
 *
 * The COMPLETE fix is to persist `.ingest-store/` across cron runs (the workflow
 * restores it via actions/cache before ingest and saves it after). Then the
 * already-correct renderer keeps serving each failed repo's PRIOR good snapshot
 * with a `staleSince` badge — a repo goes no-data ONLY if it has NEVER verified,
 * not on a transient single-repo miss.
 *
 * This test proves that semantic against the REAL production code path — the
 * filesystem-backed content / snapshot / gate-row stores, `runLivePass`, the
 * renderer's `buildRenderInput`, and the testing view-model — by running two
 * sequential ingest passes over the SAME `--root` (the persisted store the cache
 * provides), flipping one repo from reachable to unreachable between passes.
 *
 * No new npm dependency: it uses the same in-repo fixtures + FS stores the rest
 * of the suite uses, and a tmpdir for the persisted store root.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runLivePass, type LivePassDeps } from './live-pass.js';
import { FsContentStore, FsSnapshotStore, systemIngestClock } from './storage-fs.js';
import { FsGateRowStore } from './gate-row-store.js';
import { type ManifestFetcher, type SigstoreVerifier } from './interfaces.js';
import { type PinnedSubjects } from './oidc-allowlist.js';
import { type ReportManifest } from './manifest.js';
import { validEvidenceBundle } from './__fixtures__/bundle-fixtures.js';

import { StoreTestingResolver } from '../internal-testing/store-testing-resolver.js';
import { buildTestingView } from '../internal-testing/testing-row.js';

const BUNDLE = validEvidenceBundle();
const BODY = {
  gate_name: 'coverage',
  gate_decision: 'pass',
  evaluated_at: '2026-06-08T00:00:00.000Z',
  gate_id: 'iec:ci:coverage',
  gate_version: '1.0.0',
  gate_reasons: [],
  coverage: { dimensions_evaluated: ['lines'], dimensions_skipped: [] },
};

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
      } as never,
    ],
  };
}

const PASS_VERIFIER: SigstoreVerifier = { verifyRow: () => Promise.resolve() };

/** A fetcher whose per-repo reachability is controlled by a mutable set. */
class ToggleFetcher implements ManifestFetcher {
  readonly reachable = new Set<string>();
  fetch(repo: string): Promise<ReportManifest> {
    if (repo === 'iec' && this.reachable.has('iec')) {
      return Promise.resolve(iecManifest());
    }
    return Promise.reject(new Error('404 not found (simulated fetch miss)'));
  }
}

describe('partial fetch failure preserves prior-good rows (nr75.17)', () => {
  let root: string;
  let fetcher: ToggleFetcher;

  function deps(): LivePassDeps {
    return {
      fetcher,
      verifier: PASS_VERIFIER,
      // The SAME `--root` both passes — exactly what actions/cache persists.
      contentStore: new FsContentStore(root),
      snapshotStore: new FsSnapshotStore(root),
      gateRowStore: new FsGateRowStore(root),
      clock: systemIngestClock,
      pinned: PINNED,
    };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lkg-store-'));
    fetcher = new ToggleFetcher();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('serves a repo that fetched-then-missed as STALE (prior-good), not no-data', async () => {
    // ── Pass 1: iec reachable + verifies; iel never reachable. ──
    fetcher.reachable.add('iec');
    const pass1 = await runLivePass(deps(), ['iec', 'iel']);
    expect(pass1.outcomes).toContainEqual({ repo: 'iec', fresh: true });
    expect(pass1.outcomes.find((o) => o.repo === 'iel')?.fresh).toBe(false);

    // ── Pass 2: PARTIAL blackout — iec now misses; the persisted store remains. ──
    fetcher.reachable.delete('iec');
    const pass2 = await runLivePass(deps(), ['iec', 'iel']);

    // iec failed THIS pass...
    const iecOutcome = pass2.outcomes.find((o) => o.repo === 'iec');
    expect(iecOutcome?.fresh).toBe(false);
    expect(iecOutcome?.failure?.step).toBe('fetch_manifest');

    // ...but the renderer serves its PRIOR good snapshot, stamped stale.
    const iecState = pass2.input.repos.find((r) => r.repo === 'iec');
    expect(iecState?.snapshot).not.toBeNull();
    expect(iecState?.staleSince).toBeDefined();

    // And the verified rows still RESOLVE from the persisted content + gate-row
    // stores — the failed repo renders REAL data (stale), never no-data.
    const resolver = new StoreTestingResolver(new FsContentStore(root), new FsGateRowStore(root));
    const view = await buildTestingView(pass2.input, resolver);
    const iecRepo = view.repos.find((r) => r.repo === 'iec');
    expect(iecRepo?.noData).toBe(false);
    expect(iecRepo?.rows.map((r) => r.gateName)).toContain('coverage');
    expect(iecRepo?.staleSince).toBeDefined();

    // The never-verified repo IS no-data — that is the ONLY no-data path left.
    const ielRepo = view.repos.find((r) => r.repo === 'iel');
    expect(ielRepo?.noData).toBe(true);
    expect(ielRepo?.staleSince).toBeDefined(); // crashed this pass, no prior snapshot
  });

  it('without a persisted store, the same miss regresses iec to no-data (the bug this fixes)', async () => {
    // Pass 1 into store A: iec verifies.
    fetcher.reachable.add('iec');
    await runLivePass(deps(), ['iec', 'iel']);

    // Pass 2 into a FRESH (ephemeral) store — simulates the pre-fix per-run wipe.
    const ephemeral = await mkdtemp(join(tmpdir(), 'lkg-ephemeral-'));
    try {
      fetcher.reachable.delete('iec');
      const pass2 = await runLivePass(
        {
          fetcher,
          verifier: PASS_VERIFIER,
          contentStore: new FsContentStore(ephemeral),
          snapshotStore: new FsSnapshotStore(ephemeral),
          gateRowStore: new FsGateRowStore(ephemeral),
          clock: systemIngestClock,
          pinned: PINNED,
        },
        ['iec', 'iel'],
      );
      const resolver = new StoreTestingResolver(
        new FsContentStore(ephemeral),
        new FsGateRowStore(ephemeral),
      );
      const view = await buildTestingView(pass2.input, resolver);
      // No persisted prior-good → iec regresses to no-data. THIS is the regression
      // the persisted store (actions/cache) prevents.
      expect(view.repos.find((r) => r.repo === 'iec')?.noData).toBe(true);
    } finally {
      await rm(ephemeral, { recursive: true, force: true });
    }
  });
});
