/**
 * Regression tests for the Rekor-anchor propagation defect.
 *
 * Reproduces the production shape observed on the published j-rig
 * `evidence-latest` manifest (2026-09-07): every row's signed EvidenceBundle
 * carries `rekor_log_indices: []` while its sigstore bundle carries a real
 * production log index (e.g. `"2746738668"`, a protobuf-JSON int64 STRING).
 * Before the fix the dashboard read only the signed bundle's empty field, so
 * `labs.intentsolutions.io` printed an empty "Rekor anchor" cell for evidence
 * that IS anchored.
 *
 * Covers both directions:
 *   - positive: a verified sigstore bundle's log index reaches the rendered row;
 *   - negative: no tlog entry ⇒ the anchor stays EMPTY, never fabricated.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJsonBytes, sha256Key } from './content-address.js';
import { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
import { MemoryGateRowStore } from './gate-row-store.js';
import { runLivePass, type LivePassDeps } from './live-pass.js';
import { type ManifestFetcher, type SigstoreVerifier } from './interfaces.js';
import { type PinnedSubjects } from './oidc-allowlist.js';
import { type ReportManifest } from './manifest.js';
import { validEvidenceBundle } from './__fixtures__/bundle-fixtures.js';
import { verifiedRekorLogIndices } from './rekor-anchor.js';
import { StoreTestingResolver } from '../internal-testing/store-testing-resolver.js';
import { ContentStoreBundleResolver } from '../results/bundle-resolver.js';
import { StoreGateRowSource } from '../results/store-gate-row-source.js';

/** The real production log index observed on the published jrig manifest. */
const PROD_LOG_INDEX = 2746738668;

/** A sigstore v0.3 bundle in the exact shape cosign publishes (int64 as string). */
function sigstoreBundleWithIndex(logIndex: string): unknown {
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {
      tlogEntries: [
        {
          logIndex,
          integratedTime: '1788754702',
          inclusionProof: { logIndex, treeSize: '1', hashes: [] },
        },
      ],
    },
  };
}

// ── unit: the extractor ──

describe('verifiedRekorLogIndices', () => {
  it('reads the production sigstore shape, parsing the int64 STRING logIndex', () => {
    expect(verifiedRekorLogIndices(sigstoreBundleWithIndex(String(PROD_LOG_INDEX)))).toEqual([
      PROD_LOG_INDEX,
    ]);
  });

  it('reads the offline verifier shape via inclusionProof.leafIndex', () => {
    expect(verifiedRekorLogIndices({ inclusionProof: { leafIndex: 7 } })).toEqual([7]);
  });

  it('de-duplicates repeated indices and preserves bundle order', () => {
    const b = {
      verificationMaterial: {
        tlogEntries: [{ logIndex: '9' }, { logIndex: '4' }, { logIndex: '9' }],
      },
    };
    expect(verifiedRekorLogIndices(b)).toEqual([9, 4]);
  });

  it('fabricates nothing: absent, malformed, negative, or unsafe values yield []', () => {
    expect(verifiedRekorLogIndices(undefined)).toEqual([]);
    expect(verifiedRekorLogIndices(null)).toEqual([]);
    expect(verifiedRekorLogIndices({})).toEqual([]);
    expect(verifiedRekorLogIndices({ verificationMaterial: { tlogEntries: [] } })).toEqual([]);
    expect(verifiedRekorLogIndices({ verificationMaterial: { tlogEntries: [{}] } })).toEqual([]);
    expect(
      verifiedRekorLogIndices({ verificationMaterial: { tlogEntries: [{ logIndex: 'abc' }] } }),
    ).toEqual([]);
    expect(
      verifiedRekorLogIndices({ verificationMaterial: { tlogEntries: [{ logIndex: '-1' }] } }),
    ).toEqual([]);
    expect(verifiedRekorLogIndices({ inclusionProof: { leafIndex: -3 } })).toEqual([]);
    // Beyond Number.MAX_SAFE_INTEGER — refuse rather than round.
    expect(
      verifiedRekorLogIndices({
        verificationMaterial: { tlogEntries: [{ logIndex: '9007199254740993' }] },
      }),
    ).toEqual([]);
  });
});

// ── end-to-end: ingest → store → both render resolvers ──

const PINNED: PinnedSubjects = {
  issuer: 'https://token.actions.githubusercontent.com',
  repos: {
    iaj: {
      githubRepo: 'jeremylongshore/j-rig-skill-binary-eval',
      subjects: ['repo:jeremylongshore/j-rig-skill-binary-eval:ref:refs/heads/main'],
      workflowRefs: [
        'jeremylongshore/j-rig-skill-binary-eval/.github/workflows/nightly-skill-evals.yml@refs/heads/main',
      ],
      operatorConfirmed: true,
    },
  },
};

const BODY = {
  gate_name: 'jrig-nightly-skill-eval',
  gate_id: 'jrig:ci:coreweave-gpu-node-forensics',
  gate_decision: 'pass',
  evaluated_at: '2026-09-07T04:18:21.568Z',
};

/** The published j-rig bundle shape: anchored, but `rekor_log_indices` empty. */
function publishedBundle(): Record<string, unknown> {
  return { ...validEvidenceBundle(), rekor_log_indices: [] };
}

function manifest(sigstoreBundle: unknown, bundle: Record<string, unknown>): ReportManifest {
  return {
    repo: 'iaj',
    signing: {
      issuer: 'https://token.actions.githubusercontent.com',
      subject: 'repo:jeremylongshore/j-rig-skill-binary-eval:ref:refs/heads/main',
      workflowRef:
        'jeremylongshore/j-rig-skill-binary-eval/.github/workflows/nightly-skill-evals.yml@refs/heads/main',
    },
    rows: [{ bundle, sigstoreBundle, sourceSha: 'a'.repeat(40), gateResults: [BODY] } as never],
  };
}

const PASS_VERIFIER: SigstoreVerifier = { verifyRow: () => Promise.resolve() };

async function ingest(
  sigstoreBundle: unknown,
  bundle: Record<string, unknown>,
): Promise<{ deps: LivePassDeps; bundleKey: string }> {
  const fetcher: ManifestFetcher = {
    fetch: (repo) =>
      repo === 'iaj'
        ? Promise.resolve(manifest(sigstoreBundle, bundle))
        : Promise.reject(new Error('404 not found')),
  };
  const deps: LivePassDeps = {
    fetcher,
    verifier: PASS_VERIFIER,
    contentStore: new MemoryContentStore(),
    snapshotStore: new MemorySnapshotStore(),
    gateRowStore: new MemoryGateRowStore(),
    clock: { nowIso: () => '2026-09-07T05:00:00.000Z', nowMs: () => 1789023600000 },
    pinned: PINNED,
  };
  await runLivePass(deps, ['iaj']);
  return { deps, bundleKey: sha256Key(canonicalJsonBytes(bundle)) };
}

describe('Rekor anchor reaches the rendered row (published j-rig shape)', () => {
  it('internal testing resolver surfaces the verified log index despite an empty bundle field', async () => {
    const { deps, bundleKey } = await ingest(
      sigstoreBundleWithIndex(String(PROD_LOG_INDEX)),
      publishedBundle(),
    );
    const rows = await new StoreTestingResolver(deps.contentStore, deps.gateRowStore).resolve(
      bundleKey,
    );
    expect(rows).not.toBeNull();
    expect(rows?.[0]?.rekorLogIndices).toEqual([PROD_LOG_INDEX]);
  });

  it('results bundle resolver surfaces the verified log index too', async () => {
    const { deps, bundleKey } = await ingest(
      sigstoreBundleWithIndex(String(PROD_LOG_INDEX)),
      publishedBundle(),
    );
    const rows = await new ContentStoreBundleResolver(
      deps.contentStore,
      new StoreGateRowSource(deps.gateRowStore),
    ).resolve(bundleKey);
    expect(rows).not.toBeNull();
    expect(rows?.[0]?.rekorLogIndices).toEqual([PROD_LOG_INDEX]);
  });

  it('a signed bundle that DOES carry its own indices still wins over the fallback', async () => {
    const bundle = { ...validEvidenceBundle(), rekor_log_indices: [42] };
    const { deps, bundleKey } = await ingest(sigstoreBundleWithIndex('999'), bundle);
    const rows = await new StoreTestingResolver(deps.contentStore, deps.gateRowStore).resolve(
      bundleKey,
    );
    expect(rows?.[0]?.rekorLogIndices).toEqual([42]);
  });

  it('NEGATIVE: no tlog entry anywhere ⇒ the anchor stays empty, never invented', async () => {
    const { deps, bundleKey } = await ingest({ mediaType: 'x' }, publishedBundle());
    const rows = await new StoreTestingResolver(deps.contentStore, deps.gateRowStore).resolve(
      bundleKey,
    );
    expect(rows).not.toBeNull();
    expect(rows?.[0]?.rekorLogIndices).toEqual([]);

    const resultRows = await new ContentStoreBundleResolver(
      deps.contentStore,
      new StoreGateRowSource(deps.gateRowStore),
    ).resolve(bundleKey);
    expect(resultRows?.[0]?.rekorLogIndices).toEqual([]);
  });
});
