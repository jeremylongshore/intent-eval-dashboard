/**
 * Per-step verification tests for the 8-step ingest contract.
 *
 * Each step gets a REAL pass and a REAL fail. The verifier is the offline
 * real-crypto verifier (genuine Ed25519 DSSE + RFC-6962 Merkle inclusion proof)
 * so the failure cases really break cryptography, not a flag.
 */

import { describe, expect, it } from 'vitest';
import { runIngestWorker, type IngestWorkerDeps } from './worker.js';
import { isIngestCrash, type IngestReason } from './reason.js';
import { OfflineRowVerifier, type OfflineBundle } from './verifier-offline.js';
import { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
import { type ManifestFetcher, type IngestClock } from './interfaces.js';
import { type ReportManifest } from './manifest.js';
import { type PinnedSubjects } from './oidc-allowlist.js';
import {
  REPO_GITHUB,
  mintManifest,
  mintRow,
  signingClaimsFor,
  validEvidenceBundle,
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

function fixedFetcher(manifest: ReportManifest): ManifestFetcher {
  return { fetch: () => Promise.resolve(manifest) };
}

function depsFor(manifest: ReportManifest): IngestWorkerDeps {
  return {
    fetcher: fixedFetcher(manifest),
    verifier: new OfflineRowVerifier(),
    contentStore: new MemoryContentStore(),
    snapshotStore: new MemorySnapshotStore(),
    clock,
    pinned: PINNED,
  };
}

async function expectCrash(promise: Promise<unknown>): Promise<IngestReason> {
  try {
    await promise;
  } catch (err: unknown) {
    if (isIngestCrash(err)) {
      return err.reason;
    }
    throw err;
  }
  throw new Error('expected an IngestCrash but the worker resolved');
}

describe('happy path — all 8 steps pass for real', () => {
  it('verifies + content-addresses + emits a snapshot', async () => {
    const manifest = mintManifest('iec', REPO_GITHUB['iec']!, 2);
    const deps = depsFor(manifest);
    const snapshot = await runIngestWorker('iec', deps);

    expect(snapshot.repo).toBe('iec');
    expect(snapshot.bundleKeys).toHaveLength(2);
    expect(snapshot.bundleKeys.every((k) => k.startsWith('sha256:'))).toBe(true);
    expect(snapshot.lastKnownGoodIngestedAt).toBe('2026-05-30T00:00:00.000Z');
    // snapshot is retrievable
    const stored = await deps.snapshotStore.get('iec');
    expect(stored?.bundleKeys).toEqual(snapshot.bundleKeys);
  });
});

describe('step 1 — fetch manifest', () => {
  it('crashes manifest_unreachable when the fetch rejects', async () => {
    const deps: IngestWorkerDeps = {
      ...depsFor(mintManifest('iec', REPO_GITHUB['iec']!)),
      fetcher: { fetch: () => Promise.reject(new Error('ETIMEDOUT')) },
    };
    const reason = await expectCrash(runIngestWorker('iec', deps));
    expect(reason.step).toBe('fetch_manifest');
    expect(reason.reasonCode).toBe('manifest_unreachable');
  });

  it('crashes manifest_malformed when the payload fails shape check', async () => {
    const deps: IngestWorkerDeps = {
      ...depsFor(mintManifest('iec', REPO_GITHUB['iec']!)),
      fetcher: { fetch: () => Promise.resolve({ nope: true } as unknown as ReportManifest) },
    };
    const reason = await expectCrash(runIngestWorker('iec', deps));
    expect(reason.step).toBe('fetch_manifest');
    expect(reason.reasonCode).toBe('manifest_malformed');
  });
});

describe('step 2 — OIDC allowlist', () => {
  it('crashes oidc_workflow_ref_mismatch for a wrong workflow_ref', async () => {
    const manifest = mintManifest('iec', REPO_GITHUB['iec']!);
    const tampered: ReportManifest = {
      ...manifest,
      signing: {
        ...manifest.signing,
        workflowRef:
          'jeremylongshore/intent-eval-core/.github/workflows/evil.yml@refs/heads/attacker',
      },
    };
    const reason = await expectCrash(runIngestWorker('iec', depsFor(tampered)));
    expect(reason.step).toBe('verify_oidc');
    expect(reason.reasonCode).toBe('oidc_workflow_ref_mismatch');
  });

  it('crashes oidc_issuer_mismatch for a wrong issuer', async () => {
    const manifest = mintManifest('iec', REPO_GITHUB['iec']!);
    const tampered: ReportManifest = {
      ...manifest,
      signing: { ...manifest.signing, issuer: 'https://evil.example.com' },
    };
    const reason = await expectCrash(runIngestWorker('iec', depsFor(tampered)));
    expect(reason.step).toBe('verify_oidc');
    expect(reason.reasonCode).toBe('oidc_issuer_mismatch');
  });

  it('crashes oidc_subject_mismatch for a wrong subject', async () => {
    const manifest = mintManifest('iec', REPO_GITHUB['iec']!);
    const tampered: ReportManifest = {
      ...manifest,
      signing: { ...manifest.signing, subject: 'repo:attacker/evil:ref:refs/tags/v9.9.9' },
    };
    const reason = await expectCrash(runIngestWorker('iec', depsFor(tampered)));
    expect(reason.step).toBe('verify_oidc');
    expect(reason.reasonCode).toBe('oidc_subject_mismatch');
  });

  it('crashes repo_not_in_allowlist for an unknown repo', async () => {
    const manifest = mintManifest('icos', 'jeremylongshore/icos');
    const reason = await expectCrash(runIngestWorker('icos', depsFor(manifest)));
    expect(reason.step).toBe('verify_oidc');
    expect(reason.reasonCode).toBe('repo_not_in_allowlist');
  });
});

describe('step 3 — Rekor inclusion proof (real Merkle)', () => {
  it('crashes rekor_inclusion_invalid when the audit path is tampered', async () => {
    const minted = mintRow('iec', REPO_GITHUB['iec']!);
    const offline = minted.row.sigstoreBundle as OfflineBundle;
    // Corrupt one sibling hash in the audit path → recomputed root won't match.
    const badPath = [...offline.inclusionProof.auditPathHex];
    badPath[0] = 'f'.repeat(64);
    const tamperedBundle: OfflineBundle = {
      ...offline,
      inclusionProof: { ...offline.inclusionProof, auditPathHex: badPath },
    };
    const manifest: ReportManifest = {
      repo: 'iec',
      signing: signingClaimsFor('iec', REPO_GITHUB['iec']!),
      rows: [{ ...minted.row, sigstoreBundle: tamperedBundle }],
    };
    const reason = await expectCrash(runIngestWorker('iec', depsFor(manifest)));
    expect(reason.step).toBe('verify_rekor_inclusion');
    expect(reason.reasonCode).toBe('rekor_inclusion_invalid');
    expect(reason.rowIndex).toBe(0);
  });
});

describe('step 4 — DSSE signature (real Ed25519)', () => {
  it('crashes dsse_signature_invalid when the signature is tampered', async () => {
    const minted = mintRow('iec', REPO_GITHUB['iec']!);
    const offline = minted.row.sigstoreBundle as OfflineBundle;
    // Flip the signature bytes → real signature verification fails.
    const sigBuf = Buffer.from(offline.dsse.signatures[0]!.sig, 'base64');
    sigBuf[0] = sigBuf[0]! ^ 0xff;
    const tamperedBundle: OfflineBundle = {
      ...offline,
      dsse: {
        ...offline.dsse,
        signatures: [{ sig: sigBuf.toString('base64') }],
      },
    };
    const manifest: ReportManifest = {
      repo: 'iec',
      signing: signingClaimsFor('iec', REPO_GITHUB['iec']!),
      rows: [{ ...minted.row, sigstoreBundle: tamperedBundle }],
    };
    const reason = await expectCrash(runIngestWorker('iec', depsFor(manifest)));
    expect(reason.step).toBe('verify_dsse_signature');
    expect(reason.reasonCode).toBe('dsse_signature_invalid');
  });

  it('crashes dsse_signature_invalid (identity) when the signer identity is wrong', async () => {
    const minted = mintRow('iec', REPO_GITHUB['iec']!, {
      identityOverride: {
        issuer: 'https://token.actions.githubusercontent.com',
        workflowRef: 'attacker/evil/.github/workflows/release.yml@refs/tags/v1.0.0',
      },
    });
    const manifest: ReportManifest = {
      repo: 'iec',
      signing: signingClaimsFor('iec', REPO_GITHUB['iec']!),
      rows: [minted.row],
    };
    const reason = await expectCrash(runIngestWorker('iec', depsFor(manifest)));
    expect(reason.step).toBe('verify_dsse_signature');
    expect(reason.reasonCode).toBe('dsse_signature_invalid');
  });
});

describe('step 5 — kernel schema validation (real @intentsolutions/core Zod)', () => {
  it('crashes schema_invalid when a bundle violates the kernel schema', async () => {
    // A bundle with an invalid UUID + missing fields → kernel Zod rejects it.
    // We must re-sign over the (invalid) bundle so steps 3+4 pass and step 5 is
    // what actually fails — proving the schema gate is real and ordered.
    const badBundle = { ...validEvidenceBundle(), id: 'not-a-uuid' };
    const minted = mintRow('iec', REPO_GITHUB['iec']!, { bundle: badBundle });
    const manifest: ReportManifest = {
      repo: 'iec',
      signing: signingClaimsFor('iec', REPO_GITHUB['iec']!),
      rows: [minted.row],
    };
    const reason = await expectCrash(runIngestWorker('iec', depsFor(manifest)));
    expect(reason.step).toBe('validate_schema');
    expect(reason.reasonCode).toBe('schema_invalid');
    expect(reason.detail).toContain('id');
  });

  it('passes step 5 for a valid kernel-conformant bundle', async () => {
    const manifest = mintManifest('iec', REPO_GITHUB['iec']!);
    const snapshot = await runIngestWorker('iec', depsFor(manifest));
    expect(snapshot.bundleKeys).toHaveLength(1);
  });
});

describe('step 6 — content addressing', () => {
  it('crashes content_address_failed when the content store rejects', async () => {
    const manifest = mintManifest('iec', REPO_GITHUB['iec']!);
    const deps: IngestWorkerDeps = {
      ...depsFor(manifest),
      contentStore: {
        put: () => Promise.reject(new Error('disk full')),
        get: () => Promise.resolve(null),
        has: () => Promise.resolve(false),
      },
    };
    const reason = await expectCrash(runIngestWorker('iec', deps));
    expect(reason.step).toBe('content_address');
    expect(reason.reasonCode).toBe('content_address_failed');
  });

  it('content-addresses identical bundles to the same key (idempotent)', async () => {
    const row = mintRow('iec', REPO_GITHUB['iec']!);
    const manifest: ReportManifest = {
      repo: 'iec',
      signing: signingClaimsFor('iec', REPO_GITHUB['iec']!),
      rows: [row.row, row.row], // same bundle twice
    };
    const deps = depsFor(manifest);
    const snapshot = await runIngestWorker('iec', deps);
    expect(snapshot.bundleKeys[0]).toBe(snapshot.bundleKeys[1]);
    const store = deps.contentStore as MemoryContentStore;
    expect(store.size()).toBe(1);
    expect(await store.has(snapshot.bundleKeys[0]!)).toBe(true);
    expect(await store.has('sha256:' + '0'.repeat(64))).toBe(false);
  });
});

describe('step 7 — emit snapshot', () => {
  it('crashes snapshot_emit_failed when the snapshot store rejects', async () => {
    const manifest = mintManifest('iec', REPO_GITHUB['iec']!);
    const deps: IngestWorkerDeps = {
      ...depsFor(manifest),
      snapshotStore: {
        put: () => Promise.reject(new Error('readonly fs')),
        get: () => Promise.resolve(null),
      },
    };
    const reason = await expectCrash(runIngestWorker('iec', deps));
    expect(reason.step).toBe('emit_snapshot');
    expect(reason.reasonCode).toBe('snapshot_emit_failed');
  });
});

describe('verifier-thrown non-VerifyFailure is treated fail-closed', () => {
  it('an unexpected verifier error crashes at the DSSE step (does not pass through)', async () => {
    const manifest = mintManifest('iec', REPO_GITHUB['iec']!);
    const deps: IngestWorkerDeps = {
      ...depsFor(manifest),
      verifier: { verifyRow: () => Promise.reject(new Error('verifier blew up')) },
    };
    const reason = await expectCrash(runIngestWorker('iec', deps));
    expect(reason.step).toBe('verify_dsse_signature');
    expect(reason.reasonCode).toBe('dsse_signature_invalid');
    expect(reason.detail).toContain('verifier threw');
  });
});
