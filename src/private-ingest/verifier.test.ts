import { Socket } from 'node:net';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundleFromJSON, bundleToJSON } from '@sigstore/bundle';
import type { TrustedRoot } from '@sigstore/protobuf-specs';
import { loggedFixture } from '../ingest/__fixtures__/sigstore-fixtures.js';
import { PrivateRowVerifier } from './verifier.js';
const require = createRequire(import.meta.url);
const loadedTuf: unknown = createRequire(require.resolve('sigstore'))('@sigstore/tuf');
if (
  typeof loadedTuf !== 'object' ||
  loadedTuf === null ||
  !('getTrustedRoot' in loadedTuf) ||
  typeof loadedTuf.getTrustedRoot !== 'function'
) {
  throw new Error('fixture requires installed trust loader');
}
const tuf = loadedTuf as { getTrustedRoot: () => Promise<TrustedRoot> };
const workflowRef = 'fixture/private/.github/workflows/release.yml@refs/tags/v1';
const identity = `https://github.com/${workflowRef}`;
const expectedIdentity = {
  issuer: 'https://token.actions.githubusercontent.com',
  subject: 'repo:fixture/private:ref:refs/tags/v1',
  workflowRef,
};
beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('network forbidden');
  });
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
});
afterEach(() => {
  vi.restoreAllMocks();
});
async function fixture(
  certIdentity = identity,
  options: { legacy?: boolean; logCount?: 1 | 2 } = {},
) {
  const signed = await loggedFixture({
    ...options,
    payload: Buffer.from('synthetic-private-payload'),
    identity: certIdentity,
    issuer: expectedIdentity.issuer,
  });
  vi.spyOn(tuf, 'getTrustedRoot').mockResolvedValue(signed.trustedRoot);
  return {
    signed,
    input: { sigstoreBundle: signed.bundle, payloadBytes: signed.payload, expectedIdentity },
  };
}
describe('private vetted certificate and proof verification', () => {
  it('accepts exact certificate identity, actual SCT, SET, checkpoint and signature', async () => {
    const { input } = await fixture();
    await expect(new PrivateRowVerifier().verifyRow(input)).resolves.toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('accepts literal regex punctuation in a real workflow certificate', async () => {
    const ref = 'fixture/private/.github/workflows/release+(check).yml@refs/tags/v1.2';
    const { input } = await fixture(`https://github.com/${ref}`);
    await expect(
      new PrivateRowVerifier().verifyRow({
        ...input,
        expectedIdentity: { ...expectedIdentity, workflowRef: ref },
      }),
    ).resolves.toBeUndefined();
  });
  it('refuses messageSignature format under the explicit private DSSE policy', async () => {
    const signed = await loggedFixture({
      payload: Buffer.from('fixture'),
      identity,
      issuer: expectedIdentity.issuer,
      messageSignature: true,
    });
    await expect(
      new PrivateRowVerifier().verifyRow({
        sigstoreBundle: signed.bundle,
        payloadBytes: signed.payload,
        expectedIdentity,
      }),
    ).rejects.toThrow('private_dsse_required');
  });
  it.each([
    `${identity}/suffix`,
    identity.replace('github.com', 'githubXcom'),
    `${identity}\n`,
    `prefix${identity}`,
  ])('rejects a real certificate with nonexact identity %s', async (certIdentity) => {
    const { input } = await fixture(certIdentity);
    await expect(new PrivateRowVerifier().verifyRow(input)).rejects.toThrow(
      'private_verification_failed',
    );
  });
  it('rejects a genuine v0.1 promise-only bundle after vetted verification', async () => {
    const { input, signed } = await fixture(identity, { legacy: true });
    const parsed = bundleFromJSON(signed.bundle);
    parsed.verificationMaterial.tlogEntries[0]!.inclusionProof = undefined;
    await expect(
      new PrivateRowVerifier().verifyRow({ ...input, sigstoreBundle: bundleToJSON(parsed) }),
    ).rejects.toThrow('private_verification_failed');
    expect(tuf.getTrustedRoot).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed and absent proofs', async () => {
    await expect(
      new PrivateRowVerifier().verifyRow({
        sigstoreBundle: {},
        payloadBytes: new Uint8Array(),
        expectedIdentity,
      }),
    ).rejects.toThrow('private_bundle_invalid');
  });
  it('rejects invalid extra proof even after one valid entry', async () => {
    const { input, signed } = await fixture(identity, { logCount: 2 });
    const parsed = bundleFromJSON(signed.bundle);
    const bad = structuredClone(parsed.verificationMaterial.tlogEntries[1]!);
    if (!bad.inclusionProof?.checkpoint) throw new Error('fixture needs checkpoint');
    bad.inclusionProof.checkpoint.envelope = 'corrupted signed checkpoint';
    parsed.verificationMaterial.tlogEntries[1] = bad;
    await expect(
      new PrivateRowVerifier().verifyRow({ ...input, sigstoreBundle: bundleToJSON(parsed) }),
    ).rejects.toThrow('private_verification_failed');
  });
  it('rejects modified payload and sanitizes upstream failure', async () => {
    const { input } = await fixture();
    await expect(
      new PrivateRowVerifier().verifyRow({ ...input, payloadBytes: Buffer.from('changed') }),
    ).rejects.toThrow('private_verification_failed');
    vi.mocked(tuf.getTrustedRoot).mockRejectedValue(new Error('SECRET signed-query'));
    await expect(new PrivateRowVerifier().verifyRow(input)).rejects.toThrow(
      /^private_verification_failed$/u,
    );
  });
  it.each(['treeSize', 'rootHash'])(
    'rejects %s that differs from the authenticated checkpoint',
    async (field) => {
      const { input, signed } = await fixture();
      const parsed = bundleFromJSON(signed.bundle);
      const proof = parsed.verificationMaterial.tlogEntries[0]!.inclusionProof!;
      if (field === 'treeSize') proof.treeSize = '999';
      else proof.rootHash = Buffer.alloc(proof.rootHash.length, 1);
      await expect(
        new PrivateRowVerifier().verifyRow({ ...input, sigstoreBundle: bundleToJSON(parsed) }),
      ).rejects.toThrow('private_verification_failed');
    },
  );
});
