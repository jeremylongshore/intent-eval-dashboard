import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { bundleFromJSON, bundleToJSON } from '@sigstore/bundle';
import type * as Tuf from '@sigstore/tuf';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SigstoreRowVerifier } from './verifier-sigstore.js';
import { loggedFixture } from './__fixtures__/sigstore-fixtures.js';
import { runIngestWorker } from './worker.js';
import { MemoryContentStore, MemorySnapshotStore } from './storage-memory.js';
import { MemoryGateRowStore } from './gate-row-store.js';
import { canonicalJsonBytes } from './content-address.js';
import { mintRow, validEvidenceBundle } from './__fixtures__/bundle-fixtures.js';
import type { VerifyRowInput } from './interfaces.js';

// Substitute only offline trust-root acquisition in the same CJS instance used
// by sigstore. Signature, certificate, SCT, log and identity checks remain real.
const require = createRequire(import.meta.url);
const sigstoreRequire = createRequire(require.resolve('sigstore'));
const loadedTuf: unknown = sigstoreRequire('@sigstore/tuf');
if (
  typeof loadedTuf !== 'object' ||
  loadedTuf === null ||
  !('getTrustedRoot' in loadedTuf) ||
  typeof loadedTuf.getTrustedRoot !== 'function'
) {
  throw new Error('installed TUF module must expose trust-root acquisition');
}
const tuf = loadedTuf as Pick<typeof Tuf, 'getTrustedRoot'>;
const workflowRef = 'synthetic/repo/.github/workflows/evidence.yml@refs/heads/main';
const identity = `https://github.com/${workflowRef}`;
const issuer = 'https://issuer.invalid';

async function inputFor(
  san = identity,
  expectedWorkflow = workflowRef,
  legacy = false,
): Promise<VerifyRowInput> {
  const fixture = await loggedFixture({
    payload: Buffer.from('{"synthetic":"evidence"}'),
    identity: san,
    issuer,
    legacy,
  });
  vi.spyOn(tuf, 'getTrustedRoot').mockResolvedValue(fixture.trustedRoot);
  return {
    sigstoreBundle: fixture.bundle,
    payloadBytes: fixture.payload,
    expectedIdentity: {
      issuer,
      subject: 'repo:synthetic/repo:ref:refs/heads/main',
      workflowRef: expectedWorkflow,
    },
  };
}

beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('network forbidden in synthetic identity fixture');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('production Sigstore requires actual inclusion proofs', () => {
  it('rejects a valid signed inclusion promise without its proof', async () => {
    const input = await inputFor(identity, workflowRef, true);
    await expect(new SigstoreRowVerifier().verifyRow(input)).resolves.toBeUndefined();
    const bundle = bundleFromJSON(input.sigstoreBundle);
    bundle.verificationMaterial.tlogEntries[0]!.inclusionProof = undefined;
    await expect(
      new SigstoreRowVerifier().verifyRow({
        ...input,
        sigstoreBundle: bundleToJSON(bundle),
      }),
    ).rejects.toMatchObject({ name: 'VerifyFailure', kind: 'rekor_inclusion' });
  });

  for (const mutation of [
    'missing proof',
    'unknown log',
    'bad checkpoint',
    'bad root',
    'bad size',
    'bad path',
    'bad index',
    'duplicate',
  ] as const) {
    it(`rejects an extra ${mutation} after accepting two independently trusted logs`, async () => {
      const fixture = await loggedFixture({
        payload: Buffer.from('{"synthetic":"evidence"}'),
        identity,
        issuer,
        logCount: 2,
        legacy: true,
      });
      vi.spyOn(tuf, 'getTrustedRoot').mockResolvedValue(fixture.trustedRoot);
      const input = {
        sigstoreBundle: fixture.bundle,
        payloadBytes: fixture.payload,
        expectedIdentity: {
          issuer,
          subject: 'repo:synthetic/repo:ref:refs/heads/main',
          workflowRef,
        },
      };
      await expect(new SigstoreRowVerifier().verifyRow(input)).resolves.toBeUndefined();
      const bundle = bundleFromJSON(fixture.bundle);
      const second = bundle.verificationMaterial.tlogEntries[1]!;
      const proof = second.inclusionProof!;
      if (mutation === 'missing proof') second.inclusionProof = undefined;
      if (mutation === 'unknown log') second.logId.keyId = Buffer.alloc(32);
      if (mutation === 'bad checkpoint')
        proof.checkpoint!.envelope = proof.checkpoint!.envelope.replace(
          'offline-log-1',
          'forged-log-1',
        );
      if (mutation === 'bad root') proof.rootHash = Buffer.alloc(32);
      if (mutation === 'bad size') proof.treeSize = '2';
      if (mutation === 'bad path') proof.hashes.push(Buffer.alloc(32));
      if (mutation === 'bad index') proof.logIndex = '1';
      if (mutation === 'duplicate') bundle.verificationMaterial.tlogEntries.push(second);
      await expect(
        new SigstoreRowVerifier().verifyRow({
          ...input,
          sigstoreBundle: bundleToJSON(bundle),
        }),
      ).rejects.toMatchObject({ name: 'VerifyFailure' });
    });
  }
});

describe('production Sigstore payload binding', () => {
  it('rejects an authenticated DSSE payload different from the consumed artifact', async () => {
    const input = await inputFor();
    await expect(
      new SigstoreRowVerifier().verifyRow({
        ...input,
        payloadBytes: Buffer.from('{"different":"artifact"}'),
      }),
    ).rejects.toMatchObject({ name: 'VerifyFailure', kind: 'dsse_signature' });
  });

  it('refuses mismatched authenticated metadata before any worker persistence', async () => {
    const original = validEvidenceBundle();
    const changed = { ...original, created_at: '2026-06-01T00:00:00.000Z' };
    const fixture = await loggedFixture({
      payload: Buffer.from(canonicalJsonBytes(original)),
      identity,
      issuer,
    });
    vi.spyOn(tuf, 'getTrustedRoot').mockResolvedValue(fixture.trustedRoot);
    const signing = { issuer, subject: 'repo:synthetic/repo:ref:refs/heads/main', workflowRef };
    const row = mintRow('iec', 'synthetic/repo', { bundle: changed }).row;
    const contentStore = new MemoryContentStore();
    const snapshotStore = new MemorySnapshotStore();
    const gateRowStore = new MemoryGateRowStore();
    const contentWrite = vi.spyOn(contentStore, 'put');
    const snapshotWrite = vi.spyOn(snapshotStore, 'put');
    const rowWrite = vi.spyOn(gateRowStore, 'put');
    await expect(
      runIngestWorker('iec', {
        fetcher: {
          fetch: async () => ({
            repo: 'iec',
            signing,
            rows: [{ ...row, sigstoreBundle: fixture.bundle }],
          }),
        },
        verifier: new SigstoreRowVerifier(),
        contentStore,
        snapshotStore,
        gateRowStore,
        clock: { nowIso: () => '2026-06-01T00:00:00.000Z', nowMs: () => 0 },
        pinned: {
          issuer,
          repos: {
            iec: {
              githubRepo: 'synthetic/repo',
              subjects: [signing.subject],
              workflowRefs: [workflowRef],
              operatorConfirmed: true,
            },
          },
        },
      }),
    ).rejects.toMatchObject({
      reason: { step: 'verify_dsse_signature', reasonCode: 'dsse_signature_invalid' },
    });
    expect(contentWrite).not.toHaveBeenCalled();
    expect(snapshotWrite).not.toHaveBeenCalled();
    expect(rowWrite).not.toHaveBeenCalled();
    expect(contentStore.size()).toBe(0);
    expect(await snapshotStore.get('iec')).toBeNull();
  });

  it('preserves authentic messageSignature blob acceptance and rejects a different blob', async () => {
    const fixture = await loggedFixture({
      payload: Buffer.from('synthetic signed blob'),
      identity,
      issuer,
      messageSignature: true,
    });
    vi.spyOn(tuf, 'getTrustedRoot').mockResolvedValue(fixture.trustedRoot);
    const input = {
      sigstoreBundle: fixture.bundle,
      payloadBytes: fixture.payload,
      expectedIdentity: { issuer, subject: 'repo:synthetic/repo:ref:refs/heads/main', workflowRef },
    };
    await expect(new SigstoreRowVerifier().verifyRow(input)).resolves.toBeUndefined();
    await expect(
      new SigstoreRowVerifier().verifyRow({
        ...input,
        payloadBytes: Buffer.from('different blob'),
      }),
    ).rejects.toMatchObject({ name: 'VerifyFailure' });
  });
});

describe('production Sigstore certificate identity is a literal whole URI', () => {
  it('accepts the exact SAN with real certificate, SCT, signature and checkpoint', async () => {
    await expect(new SigstoreRowVerifier().verifyRow(await inputFor())).resolves.toBeUndefined();
  });

  it('accepts literal regex punctuation in the configured workflow identity', async () => {
    const ref = 'synthetic/repo/.github/workflows/evidence+(check).yml@refs/heads/v1.2';
    await expect(
      new SigstoreRowVerifier().verifyRow(await inputFor(`https://github.com/${ref}`, ref)),
    ).resolves.toBeUndefined();
  });

  for (const [name, san] of [
    ['prefix', `https://untrusted.invalid/${identity}`],
    ['suffix', `${identity}-untrusted`],
    ['regex metacharacter substitution', identity.replace('github.com', 'githubXcom')],
    ['final newline', `${identity}\n`],
  ]) {
    it(`rejects a cryptographically valid ${name} near-match`, async () => {
      await expect(new SigstoreRowVerifier().verifyRow(await inputFor(san))).rejects.toMatchObject({
        name: 'VerifyFailure',
        kind: 'identity_mismatch',
      });
    });
  }

  it('rejects a signature changed after its transparency log binding', async () => {
    const input = await inputFor();
    const bundle = bundleFromJSON(input.sigstoreBundle);
    if (bundle.content.$case !== 'dsseEnvelope') throw new Error('fixture must be DSSE');
    bundle.content.dsseEnvelope.signatures[0]!.sig = Buffer.from('invalid signature');
    await expect(
      new SigstoreRowVerifier().verifyRow({
        ...input,
        sigstoreBundle: bundleToJSON(bundle),
      }),
    ).rejects.toMatchObject({ name: 'VerifyFailure', kind: 'rekor_inclusion' });
  });

  it('rejects an invalid DSSE signature even when its log entry is authentic', async () => {
    const fixture = await loggedFixture({
      payload: Buffer.from('{"synthetic":"evidence"}'),
      identity,
      issuer,
      invalidSignature: true,
    });
    vi.spyOn(tuf, 'getTrustedRoot').mockResolvedValue(fixture.trustedRoot);
    await expect(
      new SigstoreRowVerifier().verifyRow({
        sigstoreBundle: fixture.bundle,
        payloadBytes: fixture.payload,
        expectedIdentity: {
          issuer,
          subject: 'repo:synthetic/repo:ref:refs/heads/main',
          workflowRef,
        },
      }),
    ).rejects.toMatchObject({ name: 'VerifyFailure', kind: 'dsse_signature' });
  });

  it('still rejects an invalid inclusion proof', async () => {
    const input = await inputFor();
    const bundle = bundleFromJSON(input.sigstoreBundle);
    const proof = bundle.verificationMaterial.tlogEntries[0]!.inclusionProof;
    if (!proof) throw new Error('fixture must contain an inclusion proof');
    proof.hashes.push(Buffer.alloc(32));
    await expect(
      new SigstoreRowVerifier().verifyRow({
        ...input,
        sigstoreBundle: bundleToJSON(bundle),
      }),
    ).rejects.toMatchObject({ name: 'VerifyFailure', kind: 'rekor_inclusion' });
  });

  it('still rejects the wrong pinned issuer', async () => {
    const input = await inputFor();
    await expect(
      new SigstoreRowVerifier().verifyRow({
        ...input,
        expectedIdentity: { ...input.expectedIdentity, issuer: 'https://other.invalid' },
      }),
    ).rejects.toMatchObject({ name: 'VerifyFailure', kind: 'identity_mismatch' });
  });
});
