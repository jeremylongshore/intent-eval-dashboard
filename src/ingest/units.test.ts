/**
 * Focused unit tests for the ingest building blocks not fully exercised by the
 * worker / attack tests: OIDC matcher edge cases, content-address canonicality,
 * manifest shape guard, renderer buildRenderInput, the offline verifier's
 * malformed-proof branches, pinned-loader parsing, and the tree spec builders.
 */

import { describe, expect, it } from 'vitest';
import { checkOidcAllowlist, matchesPinnedPattern, type PinnedSubjects } from './oidc-allowlist.js';
import {
  parsePinnedSubjects,
  defaultPinnedSubjectsPath,
  loadPinnedSubjects,
} from './pinned-loader.js';
import { runDeployPass } from './tree.js';
import { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
import { Publisher } from './publisher.js';
import { NoopPublisherTransport } from './publisher-transport-noop.js';
import { type IngestWorkerDeps } from './worker.js';
import { canonicalJsonBytes, sha256Key, stableStringify } from './content-address.js';
import { isReportManifestShape } from './manifest.js';
import { Renderer, buildRenderInput, type RenderInput, type RenderSink } from './renderer.js';
import {
  computeMerkleRootHex,
  dssePae,
  merkleLeafHashHex,
  OfflineRowVerifier,
  type OfflineBundle,
} from './verifier-offline.js';
import { VerifyFailure } from './interfaces.js';
import {
  INGEST_REPOS,
  buildDeploySupervisorSpec,
  buildIngestSupervisorSpec,
  DEFAULT_INGEST_BUDGET,
} from './tree.js';
import { type IngestSnapshot } from './interfaces.js';

describe('matchesPinnedPattern', () => {
  it('exact match', () => {
    expect(matchesPinnedPattern('a/b/c', 'a/b/c')).toBe(true);
    expect(matchesPinnedPattern('a/b/c', 'a/b/d')).toBe(false);
  });
  it('single trailing-star prefix match', () => {
    expect(matchesPinnedPattern('repo:x:ref:refs/tags/*', 'repo:x:ref:refs/tags/v1.0.0')).toBe(
      true,
    );
    expect(matchesPinnedPattern('repo:x:ref:refs/tags/*', 'repo:y:ref:refs/tags/v1.0.0')).toBe(
      false,
    );
  });
  it('mid-string star is treated literally (no wildcard smuggling)', () => {
    expect(matchesPinnedPattern('a/*/c', 'a/b/c')).toBe(false);
    expect(matchesPinnedPattern('a/*/c', 'a/*/c')).toBe(true);
  });
});

describe('checkOidcAllowlist — ok path', () => {
  const pinned: PinnedSubjects = {
    issuer: 'https://issuer',
    repos: {
      iec: {
        githubRepo: 'o/iec',
        subjects: ['repo:o/iec:ref:refs/tags/*'],
        workflowRefs: ['o/iec/.github/workflows/release.yml@refs/tags/*'],
        operatorConfirmed: true,
      },
    },
  };
  it('returns ok for a matching claim set', () => {
    const r = checkOidcAllowlist(pinned, 'iec', {
      issuer: 'https://issuer',
      subject: 'repo:o/iec:ref:refs/tags/v1.2.3',
      workflowRef: 'o/iec/.github/workflows/release.yml@refs/tags/v1.2.3',
    });
    expect(r.ok).toBe(true);
  });
});

describe('content addressing', () => {
  it('hashes equal logical objects to the same key regardless of key order', () => {
    const a = sha256Key(canonicalJsonBytes({ x: 1, y: 2 }));
    const b = sha256Key(canonicalJsonBytes({ y: 2, x: 1 }));
    expect(a).toBe(b);
    expect(a.startsWith('sha256:')).toBe(true);
  });
  it('stableStringify sorts nested keys + preserves arrays', () => {
    expect(stableStringify({ b: [3, 2, 1], a: { d: 1, c: 2 } })).toBe(
      '{"a":{"c":2,"d":1},"b":[3,2,1]}',
    );
  });
  it('handles primitives + null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
  });
});

describe('isReportManifestShape', () => {
  it('rejects non-objects + missing fields', () => {
    expect(isReportManifestShape(null)).toBe(false);
    expect(isReportManifestShape({})).toBe(false);
    expect(isReportManifestShape({ repo: 'x' })).toBe(false);
    expect(isReportManifestShape({ repo: 'x', signing: {} })).toBe(false);
  });
  it('rejects when signing claims are not strings', () => {
    expect(
      isReportManifestShape({
        repo: 'x',
        signing: { issuer: 1, subject: 's', workflowRef: 'w' },
        rows: [],
      }),
    ).toBe(false);
  });
  it('rejects when rows is not an array of well-shaped rows', () => {
    expect(
      isReportManifestShape({
        repo: 'x',
        signing: { issuer: 'i', subject: 's', workflowRef: 'w' },
        rows: [{ bundle: {} }],
      }),
    ).toBe(false);
  });
  it('accepts a well-formed manifest', () => {
    expect(
      isReportManifestShape({
        repo: 'x',
        signing: { issuer: 'i', subject: 's', workflowRef: 'w' },
        rows: [{ bundle: {}, sigstoreBundle: {}, sourceSha: 'abc' }],
      }),
    ).toBe(true);
  });
});

describe('buildRenderInput', () => {
  it('serves fresh snapshots without stale badge + prior-good for crashed repos', async () => {
    const store = new MemorySnapshotStore();
    const freshSnap: IngestSnapshot = {
      repo: 'iec',
      lastKnownGoodIngestedAt: '2026-05-30T00:00:00.000Z',
      sourceSha: 'a',
      bundleKeys: ['sha256:' + '1'.repeat(64)],
    };
    const priorSnap: IngestSnapshot = {
      repo: 'iah',
      lastKnownGoodIngestedAt: '2026-05-28T00:00:00.000Z',
      sourceSha: 'b',
      bundleKeys: ['sha256:' + '2'.repeat(64)],
    };
    await store.put(freshSnap);
    await store.put(priorSnap);

    const input = await buildRenderInput(
      store,
      [
        { repo: 'iec', fresh: true },
        {
          repo: 'iah',
          fresh: false,
          failure: { step: 'fetch_manifest', reasonCode: 'manifest_unreachable' },
        },
      ],
      '2026-05-30T12:00:00.000Z',
    );
    const iec = input.repos.find((r) => r.repo === 'iec');
    const iah = input.repos.find((r) => r.repo === 'iah');
    expect(iec?.staleSince).toBeUndefined();
    expect(iah?.staleSince).toBe('2026-05-28T00:00:00.000Z');
    expect(iah?.lastFailure?.reasonCode).toBe('manifest_unreachable');
  });

  it('uses now as staleSince when a crashed repo has no prior snapshot', async () => {
    const store = new MemorySnapshotStore();
    const input = await buildRenderInput(
      store,
      [{ repo: 'iel', fresh: false }],
      '2026-05-30T12:00:00.000Z',
    );
    const iel = input.repos.find((r) => r.repo === 'iel');
    expect(iel?.snapshot).toBeNull();
    expect(iel?.staleSince).toBe('2026-05-30T12:00:00.000Z');
  });
});

describe('offline verifier — Merkle internals', () => {
  it('computeMerkleRootHex on a single-leaf tree returns the leaf', () => {
    const leaf = merkleLeafHashHex(new TextEncoder().encode('x'));
    expect(
      computeMerkleRootHex({
        leafHashHex: leaf,
        leafIndex: 0,
        treeSize: 1,
        auditPathHex: [],
        rootHashHex: leaf,
      }),
    ).toBe(leaf);
  });
  it('throws when the audit path is longer than the tree height', () => {
    const leaf = merkleLeafHashHex(new TextEncoder().encode('x'));
    expect(() =>
      computeMerkleRootHex({
        leafHashHex: leaf,
        leafIndex: 0,
        treeSize: 1,
        auditPathHex: ['a'.repeat(64)],
        rootHashHex: leaf,
      }),
    ).toThrow(/audit path/);
  });
  it('dssePae encodes the in-toto DSSEv1 PAE header', () => {
    const pae = dssePae('app/type', new Uint8Array([1, 2, 3])).toString('utf8');
    expect(pae.startsWith('DSSEv1 8 app/type 3 ')).toBe(true);
  });

  it('recomputes the same root from EVERY leaf position in a 4-leaf tree (odd + even indices)', () => {
    // Build a real RFC-6962 4-leaf Merkle tree, then prove computeMerkleRootHex
    // recovers the same root from each leaf — exercising both the even-child and
    // odd-child (right sibling) audit-path branches.
    const NODE = Buffer.from([0x01]);
    const node = (l: string, r: string): string =>
      sha256Key(Buffer.concat([NODE, Buffer.from(l, 'hex'), Buffer.from(r, 'hex')])).slice(
        'sha256:'.length,
      );
    const leaves = [0, 1, 2, 3].map((n) =>
      merkleLeafHashHex(new TextEncoder().encode(`leaf-${n}`)),
    );
    const h01 = node(leaves[0]!, leaves[1]!);
    const h23 = node(leaves[2]!, leaves[3]!);
    const root = node(h01, h23);

    // Audit paths for each leaf (sibling-at-each-level, leaf→root).
    const auditPaths: string[][] = [
      [leaves[1]!, h23], // leaf 0: even index, right sibling then aunt
      [leaves[0]!, h23], // leaf 1: odd index, left sibling then aunt
      [leaves[3]!, h01], // leaf 2: even index
      [leaves[2]!, h01], // leaf 3: odd index
    ];
    for (let i = 0; i < 4; i++) {
      const computed = computeMerkleRootHex({
        leafHashHex: leaves[i]!,
        leafIndex: i,
        treeSize: 4,
        auditPathHex: auditPaths[i]!,
        rootHashHex: root,
      });
      expect(computed).toBe(root);
    }
  });
});

describe('offline verifier — failure branches', () => {
  const expected = {
    issuer: 'https://issuer',
    subject: 's',
    workflowRef: 'o/r/.github/workflows/release.yml@refs/tags/v1',
  };
  const verifier = new OfflineRowVerifier();

  async function failKind(bundle: OfflineBundle, payloadBytes: Uint8Array): Promise<string> {
    try {
      await verifier.verifyRow({
        sigstoreBundle: bundle,
        payloadBytes,
        expectedIdentity: expected,
      });
    } catch (err: unknown) {
      if (err instanceof VerifyFailure) return err.kind;
    }
    throw new Error('expected VerifyFailure');
  }

  it('rejects an inclusion proof whose leaf hash does not match the payload', async () => {
    const payload = new TextEncoder().encode('real');
    const bundle: OfflineBundle = {
      dsse: {
        payloadType: 't',
        payload: Buffer.from(payload).toString('base64'),
        signatures: [{ sig: '' }],
      },
      inclusionProof: {
        leafHashHex: 'f'.repeat(64), // wrong leaf
        leafIndex: 0,
        treeSize: 1,
        auditPathHex: [],
        rootHashHex: 'f'.repeat(64),
      },
      signerPublicKeyPem: 'x',
      identity: { issuer: expected.issuer, workflowRef: expected.workflowRef },
    };
    expect(await failKind(bundle, payload)).toBe('rekor_inclusion');
  });

  it('rejects a malformed inclusion proof (audit path too long)', async () => {
    const payload = new TextEncoder().encode('real');
    const leaf = merkleLeafHashHex(payload);
    const bundle: OfflineBundle = {
      dsse: {
        payloadType: 't',
        payload: Buffer.from(payload).toString('base64'),
        signatures: [{ sig: '' }],
      },
      inclusionProof: {
        leafHashHex: leaf,
        leafIndex: 0,
        treeSize: 1,
        auditPathHex: ['a'.repeat(64)], // longer than height
        rootHashHex: leaf,
      },
      signerPublicKeyPem: 'x',
      identity: { issuer: expected.issuer, workflowRef: expected.workflowRef },
    };
    expect(await failKind(bundle, payload)).toBe('rekor_inclusion');
  });

  it('rejects when the DSSE payload does not match the bundle bytes', async () => {
    const payload = new TextEncoder().encode('real');
    const leaf = merkleLeafHashHex(payload);
    const bundle: OfflineBundle = {
      dsse: {
        payloadType: 't',
        payload: Buffer.from(new TextEncoder().encode('different')).toString('base64'),
        signatures: [{ sig: '' }],
      },
      inclusionProof: {
        leafHashHex: leaf,
        leafIndex: 0,
        treeSize: 1,
        auditPathHex: [],
        rootHashHex: leaf,
      },
      signerPublicKeyPem: 'x',
      identity: { issuer: expected.issuer, workflowRef: expected.workflowRef },
    };
    expect(await failKind(bundle, payload)).toBe('dsse_signature');
  });

  it('rejects when the DSSE envelope has no signatures', async () => {
    const payload = new TextEncoder().encode('real');
    const leaf = merkleLeafHashHex(payload);
    const bundle: OfflineBundle = {
      dsse: { payloadType: 't', payload: Buffer.from(payload).toString('base64'), signatures: [] },
      inclusionProof: {
        leafHashHex: leaf,
        leafIndex: 0,
        treeSize: 1,
        auditPathHex: [],
        rootHashHex: leaf,
      },
      signerPublicKeyPem: 'x',
      identity: { issuer: expected.issuer, workflowRef: expected.workflowRef },
    };
    expect(await failKind(bundle, payload)).toBe('dsse_signature');
  });

  it('rejects when the signature verification errors (bad key)', async () => {
    const payload = new TextEncoder().encode('real');
    const leaf = merkleLeafHashHex(payload);
    const bundle: OfflineBundle = {
      dsse: {
        payloadType: 't',
        payload: Buffer.from(payload).toString('base64'),
        signatures: [{ sig: Buffer.from('xx').toString('base64') }],
      },
      inclusionProof: {
        leafHashHex: leaf,
        leafIndex: 0,
        treeSize: 1,
        auditPathHex: [],
        rootHashHex: leaf,
      },
      signerPublicKeyPem: 'not-a-pem',
      identity: { issuer: expected.issuer, workflowRef: expected.workflowRef },
    };
    expect(await failKind(bundle, payload)).toBe('dsse_signature');
  });
});

describe('parsePinnedSubjects', () => {
  it('parses a valid document', () => {
    const doc = parsePinnedSubjects({
      issuer: 'https://i',
      repos: {
        iec: { githubRepo: 'o/iec', subjects: ['s'], workflowRefs: ['w'], operatorConfirmed: true },
      },
    });
    expect(doc.issuer).toBe('https://i');
    expect(doc.repos['iec']?.operatorConfirmed).toBe(true);
  });
  it('defaults operatorConfirmed to false when absent', () => {
    const doc = parsePinnedSubjects({
      issuer: 'https://i',
      repos: { iec: { githubRepo: 'o/iec', subjects: ['s'], workflowRefs: ['w'] } },
    });
    expect(doc.repos['iec']?.operatorConfirmed).toBe(false);
  });
  it('carries an optional manifestTag through, and omits it when absent', () => {
    const doc = parsePinnedSubjects({
      issuer: 'https://i',
      repos: {
        ccp: {
          githubRepo: 'o/ccp',
          subjects: ['s'],
          workflowRefs: ['w'],
          manifestTag: 'evidence-latest',
        },
        iec: { githubRepo: 'o/iec', subjects: ['s'], workflowRefs: ['w'] },
      },
    });
    expect(doc.repos['ccp']?.manifestTag).toBe('evidence-latest');
    expect(doc.repos['iec']?.manifestTag).toBeUndefined();
    expect(Object.keys(doc.repos['iec'] ?? {})).not.toContain('manifestTag');
  });
  it('rejects a non-string manifestTag', () => {
    expect(() =>
      parsePinnedSubjects({
        issuer: 'i',
        repos: { x: { githubRepo: 'g', subjects: [], workflowRefs: [], manifestTag: 7 } },
      }),
    ).toThrow(/manifestTag/);
  });
  it('rejects an empty or whitespace-only manifestTag', () => {
    for (const bad of ['', '   ']) {
      expect(() =>
        parsePinnedSubjects({
          issuer: 'i',
          repos: { x: { githubRepo: 'g', subjects: [], workflowRefs: [], manifestTag: bad } },
        }),
      ).toThrow(/non-empty/);
    }
  });
  it('rejects malformed documents', () => {
    expect(() => parsePinnedSubjects(null)).toThrow();
    expect(() => parsePinnedSubjects({})).toThrow(/issuer/);
    expect(() => parsePinnedSubjects({ issuer: 'i' })).toThrow(/repos/);
    expect(() => parsePinnedSubjects({ issuer: 'i', repos: { x: null } })).toThrow(/not an object/);
    expect(() =>
      parsePinnedSubjects({ issuer: 'i', repos: { x: { subjects: [], workflowRefs: [] } } }),
    ).toThrow(/githubRepo/);
    expect(() =>
      parsePinnedSubjects({
        issuer: 'i',
        repos: { x: { githubRepo: 'g', subjects: 'no', workflowRefs: [] } },
      }),
    ).toThrow(/subjects/);
    expect(() =>
      parsePinnedSubjects({
        issuer: 'i',
        repos: { x: { githubRepo: 'g', subjects: [], workflowRefs: 1 } },
      }),
    ).toThrow(/workflowRefs/);
  });
  it('defaultPinnedSubjectsPath ends at the ingest allowlist file', () => {
    expect(defaultPinnedSubjectsPath().endsWith('ingest/pinned-subjects.json')).toBe(true);
  });

  it('loadPinnedSubjects loads the shipped allowlist with exactly the 8 ingest repos', async () => {
    const pinned = await loadPinnedSubjects();
    expect(pinned.issuer).toBe('https://token.actions.githubusercontent.com');
    expect(Object.keys(pinned.repos).sort()).toEqual([
      'ccp',
      'iah',
      'iaj',
      'iar',
      'iec',
      'iel',
      'jrig',
      'qmd',
    ]);
    // ICOS must NOT be in the shipped allowlist (struck from the tree).
    expect(pinned.repos['icos']).toBeUndefined();
    // iec is operator-confirmed; the others carry the operator-confirmable flag.
    expect(pinned.repos['iec']?.operatorConfirmed).toBe(true);
    // jrig + qmd are pinned BEFORE their emitters' first run (the ccp #51→#52
    // sequence): operatorConfirmed stays false until the first live manifest
    // verifies, and both resolve manifests off the rolling evidence-latest tag.
    expect(pinned.repos['jrig']?.operatorConfirmed).toBe(false);
    expect(pinned.repos['jrig']?.manifestTag).toBe('evidence-latest');
    expect(pinned.repos['jrig']?.githubRepo).toBe('jeremylongshore/j-rig-skill-binary-eval');
    expect(pinned.repos['qmd']?.operatorConfirmed).toBe(false);
    expect(pinned.repos['qmd']?.manifestTag).toBe('evidence-latest');
    expect(pinned.repos['qmd']?.githubRepo).toBe('jeremylongshore/qmd-team-intent-kb');
  });
});

describe('runDeployPass — a raw (non-IngestCrash) rejection still fails closed', () => {
  it('a fetcher rejecting with a non-Error value crashes the repo (no pass-through)', async () => {
    const store = new MemoryContentStore();
    const sink: RenderSink = { render: (_: RenderInput) => Promise.resolve() };
    const snapshotStore = new MemorySnapshotStore();
    const deps: IngestWorkerDeps = {
      // Reject with a raw string (not an Error, not an IngestCrash) — the worker
      // still wraps it into a fail-closed IngestCrash at step 1. The non-Error
      // rejection is the deliberate point of this test.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      fetcher: { fetch: () => Promise.reject('raw string failure') },
      verifier: new OfflineRowVerifier(),
      contentStore: store,
      snapshotStore,
      clock: { nowIso: () => '2026-05-30T00:00:00.000Z', nowMs: () => 0 },
      pinned: PINNED_FOR_DEPLOY,
    };
    const renderer = new Renderer(snapshotStore, sink);
    const publisher = new Publisher(new NoopPublisherTransport({ info: () => {} }));
    const result = await runDeployPass(deps, renderer, publisher, '/tmp/out', ['iec']);
    const iec = result.ingest.find((o) => o.repo === 'iec');
    expect(iec?.fresh).toBe(false);
    expect(iec?.failure?.step).toBe('fetch_manifest');
  });
});

const PINNED_FOR_DEPLOY: PinnedSubjects = {
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

describe('tree spec builders', () => {
  it('INGEST_REPOS is exactly the 8 repos (ICOS struck)', () => {
    expect([...INGEST_REPOS]).toEqual(['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp', 'jrig', 'qmd']);
    expect(INGEST_REPOS).not.toContain('icos');
  });

  it('buildIngestSupervisorSpec yields one_for_one with 8 transient workers', () => {
    const spec = buildIngestSupervisorSpec(() => Promise.resolve());
    expect(spec.id).toBe('ingest_supervisor');
    expect(spec.strategy).toBe('one_for_one');
    expect(spec.children).toHaveLength(8);
    expect(spec.children.every((c) => c.restart === 'transient')).toBe(true);
    expect(spec.children.map((c) => c.id)).toEqual([
      'ingest_worker:iec',
      'ingest_worker:iel',
      'ingest_worker:iah',
      'ingest_worker:iaj',
      'ingest_worker:iar',
      'ingest_worker:ccp',
      'ingest_worker:jrig',
      'ingest_worker:qmd',
    ]);
    expect(spec.budget).toEqual(DEFAULT_INGEST_BUDGET);
  });

  it('a worker child returns normal on a clean pass and crashes on a thrown pass', async () => {
    const okSpec = buildIngestSupervisorSpec(() => Promise.resolve(), ['iec']);
    const okExit = await okSpec.children[0]!.start();
    expect(okExit).toEqual({ kind: 'normal' });

    const failSpec = buildIngestSupervisorSpec(() => Promise.reject(new Error('boom')), ['iec']);
    await expect(failSpec.children[0]!.start()).rejects.toThrow('boom');
  });

  it('buildDeploySupervisorSpec yields rest_for_one with ingest→renderer→publisher order', async () => {
    const spec = buildDeploySupervisorSpec({
      ingestSupervisor: () => Promise.resolve(),
      renderer: () => Promise.resolve(),
      publisher: () => Promise.resolve(),
    });
    expect(spec.id).toBe('deploy_supervisor');
    expect(spec.strategy).toBe('rest_for_one');
    expect(spec.children.map((c) => c.id)).toEqual(['ingest_supervisor', 'renderer', 'publisher']);
    expect(spec.children.every((c) => c.restart === 'permanent')).toBe(true);
    // each node start wraps the injected fn and returns normal
    for (const child of spec.children) {
      expect(await child.start()).toEqual({ kind: 'normal' });
    }
  });

  it('buildDeploySupervisorSpec accepts a custom budget', () => {
    const spec = buildDeploySupervisorSpec({
      ingestSupervisor: () => Promise.resolve(),
      renderer: () => Promise.resolve(),
      publisher: () => Promise.resolve(),
      budget: { maxRestarts: 9, periodMs: 1 },
    });
    expect(spec.budget).toEqual({ maxRestarts: 9, periodMs: 1 });
  });
});
