/**
 * Offline fixture construction adapted from the qualified rollout verifier.
 * Official mock helpers mint real CA certificates, SCTs, SETs and checkpoints.
 * Signing here is fixture construction; production verification remains vetted.
 * No fixture keys, roots or identities are production trust enrollment.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  BUNDLE_V01_MEDIA_TYPE,
  bundleToJSON,
  toDSSEBundle,
  toMessageSignatureBundle,
} from '@sigstore/bundle';
import { dsse } from '@sigstore/core';
import { initializeCA, initializeCTLog, initializeTLog } from '@sigstore/mock';
import { TrustedRoot } from '@sigstore/protobuf-specs';

const keyPair = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const bytes = (view: ArrayBufferView<ArrayBuffer>): Buffer<ArrayBuffer> =>
  Buffer.from(view.buffer, view.byteOffset, view.byteLength);

export async function loggedFixture(options: {
  payload: Buffer;
  identity: string;
  issuer?: string;
  invalidSignature?: boolean;
  messageSignature?: boolean;
  logCount?: 1 | 2;
  legacy?: boolean;
}) {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const validFor = {
    start: new Date(now.getTime() - 86_400_000).toISOString(),
    end: new Date(now.getTime() + 86_400_000).toISOString(),
  };
  const signer = keyPair();
  const ctKeys = keyPair();
  const ct = await initializeCTLog(ctKeys, now);
  const ca = await initializeCA(keyPair(), ct, new Date(now.getTime() - 60_000));
  const certificate = bytes(
    await ca.issueCertificate({
      publicKey: signer.publicKey.export({ type: 'spki', format: 'der' }),
      subjectAltName: options.identity,
      extensions: [
        {
          oid: '1.3.6.1.4.1.57264.1.1',
          value: options.issuer ?? 'https://issuer.invalid',
          legacy: true,
        },
      ],
    }),
  );
  const payloadType = 'application/vnd.in-toto+json';
  const signature = options.invalidSignature
    ? Buffer.from('invalid signature')
    : sign(
        'sha256',
        options.messageSignature
          ? options.payload
          : dsse.preAuthEncoding(payloadType, options.payload),
        signer.privateKey,
      );
  const digest = createHash('sha256').update(options.payload).digest();
  const bundle = options.messageSignature
    ? toMessageSignatureBundle({
        digest,
        signature,
        certificate,
        certificateChain: options.legacy ?? false,
      })
    : toDSSEBundle({
        artifact: options.payload,
        artifactType: payloadType,
        signature,
        certificate,
        certificateChain: options.legacy ?? false,
      });
  if (options.legacy) bundle.mediaType = BUNDLE_V01_MEDIA_TYPE;
  const logRoot = (baseUrl: string, publicKey: Buffer, logID: Buffer) => ({
    baseUrl,
    hashAlgorithm: 'SHA2_256',
    logId: { keyId: logID.toString('base64') },
    publicKey: {
      rawBytes: publicKey.toString('base64'),
      keyDetails: 'PKIX_ECDSA_P256_SHA_256',
      validFor,
    },
  });
  const logRoots: ReturnType<typeof logRoot>[] = [];
  for (let index = 0; index < (options.logCount ?? 1); index++) {
    const logKeys = keyPair();
    const logUrl = `https://offline-log-${index}.invalid`;
    // The upstream CA root uses its construction wall clock. Capture log time
    // after certificate creation so a second boundary cannot predate that root.
    const log = await initializeTLog(logUrl, logKeys, new Date());
    const kind = options.messageSignature ? 'hashedrekord' : 'dsse';
    const entries = await log.log({
      apiVersion: '0.0.1',
      kind,
      spec: options.messageSignature
        ? {
            signature: { content: signature.toString('base64') },
            data: { hash: { algorithm: 'sha256', value: digest.toString('hex') } },
          }
        : {
            signatures: [{ signature: signature.toString('base64') }],
            payloadHash: { algorithm: 'sha256', value: digest.toString('hex') },
          },
    });
    const entry = Object.values(entries)[0]!;
    const proof = entry.verification!.inclusionProof!;
    const timestamp = entry.verification?.signedEntryTimestamp;
    if (!timestamp) throw new Error('synthetic log omitted signed timestamp');
    if (typeof entry.body !== 'string') throw new Error('synthetic log omitted encoded body');
    bundle.verificationMaterial.tlogEntries.push({
      logIndex: String(entry.logIndex),
      integratedTime: String(entry.integratedTime),
      logId: { keyId: Buffer.from(entry.logID, 'hex') },
      kindVersion: { kind, version: '0.0.1' },
      canonicalizedBody: Buffer.from(entry.body, 'base64'),
      inclusionPromise: { signedEntryTimestamp: Buffer.from(timestamp, 'base64') },
      inclusionProof: {
        logIndex: String(proof.logIndex),
        treeSize: String(proof.treeSize),
        rootHash: Buffer.from(proof.rootHash, 'hex'),
        hashes: proof.hashes.map((hash) => Buffer.from(hash, 'hex')),
        checkpoint: { envelope: proof.checkpoint },
      },
    });
    logRoots.push(
      logRoot(
        logUrl,
        Buffer.from(log.publicKey),
        createHash('sha256').update(log.publicKey).digest(),
      ),
    );
  }
  const trustedRoot = TrustedRoot.fromJSON({
    mediaType: 'application/vnd.dev.sigstore.trustedroot.v0.1+json',
    certificateAuthorities: [
      {
        uri: 'https://offline-ca.invalid',
        certChain: { certificates: [{ rawBytes: bytes(ca.rootCertificate).toString('base64') }] },
        validFor,
      },
    ],
    timestampAuthorities: [],
    ctlogs: [
      logRoot(
        'https://offline-ct.invalid',
        ctKeys.publicKey.export({ type: 'spki', format: 'der' }),
        bytes(ct.logID),
      ),
    ],
    tlogs: logRoots,
  });
  return { bundle: bundleToJSON(bundle), trustedRoot, payload: options.payload };
}
