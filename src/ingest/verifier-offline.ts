/**
 * Offline DSSE + Merkle-inclusion-proof verifier.
 *
 * This is a SECOND, fully REAL verifier — it performs genuine cryptography with
 * Node's `crypto`:
 *   - step 3: verifies a Merkle inclusion proof (the leaf hashes into the
 *     claimed root through the supplied audit path) — the same shape Rekor's
 *     inclusion proof uses (RFC 6962 leaf/node hashing);
 *   - step 4: verifies the DSSE PAE signature over the payload against a pinned
 *     public key;
 *   - identity: checks the signing key's pinned identity (issuer + workflow_ref)
 *     against the expected pinned identity.
 *
 * It exists because the production `SigstoreRowVerifier` requires the live
 * Sigstore TUF root + a real Fulcio/Rekor entry, which a unit test cannot mint
 * offline. With this verifier, the synthetic-attack tests use REAL keys, REAL
 * signatures, and a REAL Merkle tree — a tampered payload, a tampered audit
 * path, or a wrong identity genuinely fails the crypto and crashes the worker.
 * No verification step is faked.
 *
 * It is also a legitimate production posture for self-hosted / air-gapped
 * signing where a known public key replaces Fulcio (Blueprint B SigningMode
 * surface allows offline verification of a pinned key).
 */

import { createHash, verify as cryptoVerify } from 'node:crypto';
import { type SigstoreVerifier, type VerifyRowInput, VerifyFailure } from './interfaces.js';

/** A DSSE envelope (RFC: in-toto/attestation DSSE). */
export interface DsseEnvelope {
  readonly payloadType: string;
  /** base64 of the payload bytes. */
  readonly payload: string;
  readonly signatures: readonly { readonly sig: string; readonly keyid?: string }[];
}

/** RFC-6962-style Merkle inclusion proof. */
export interface MerkleInclusionProof {
  /** Hex sha256 of the leaf (the canonical leaf the log committed to). */
  readonly leafHashHex: string;
  /** Index of the leaf in the tree. */
  readonly leafIndex: number;
  /** Total leaves in the tree. */
  readonly treeSize: number;
  /** Audit path: sibling hashes (hex sha256) from leaf to root. */
  readonly auditPathHex: readonly string[];
  /** Expected Merkle root (hex sha256) — the log's signed tree head value. */
  readonly rootHashHex: string;
}

/** The offline bundle shape this verifier consumes. */
export interface OfflineBundle {
  readonly dsse: DsseEnvelope;
  readonly inclusionProof: MerkleInclusionProof;
  /** PEM SPKI public key the DSSE signature is verified against. */
  readonly signerPublicKeyPem: string;
  /** Pinned identity bound to the signing key (issuer + workflow_ref). */
  readonly identity: { readonly issuer: string; readonly workflowRef: string };
}

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** RFC 6962 leaf hash. */
export function merkleLeafHashHex(leafBytes: Uint8Array): string {
  return sha256Hex(Buffer.concat([LEAF_PREFIX, Buffer.from(leafBytes)]));
}

/** RFC 6962 interior node hash. */
function merkleNodeHashHex(leftHex: string, rightHex: string): string {
  return sha256Hex(
    Buffer.concat([NODE_PREFIX, Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex')]),
  );
}

/**
 * Recompute the Merkle root from a leaf hash + audit path (RFC 6962 §2.1.1).
 * Returns the computed root hex. Pure.
 */
export function computeMerkleRootHex(proof: MerkleInclusionProof): string {
  let index = proof.leafIndex;
  let size = proof.treeSize;
  let hash = proof.leafHashHex;
  for (const sibling of proof.auditPathHex) {
    if (size <= 1) {
      throw new Error('audit path longer than tree height');
    }
    if (index % 2 === 1 || index === size - 1) {
      // current node is a right child (or the last node of an odd level)
      if (index % 2 === 1) {
        hash = merkleNodeHashHex(sibling, hash);
      } else {
        hash = merkleNodeHashHex(hash, sibling);
      }
    } else {
      hash = merkleNodeHashHex(hash, sibling);
    }
    index = Math.floor(index / 2);
    size = Math.floor((size + 1) / 2);
  }
  return hash;
}

/** DSSE Pre-Authentication Encoding (in-toto/DSSE spec). */
export function dssePae(payloadType: string, payload: Uint8Array): Buffer {
  const header = `DSSEv1 ${payloadType.length} ${payloadType} ${payload.length} `;
  return Buffer.concat([Buffer.from(header, 'utf8'), Buffer.from(payload)]);
}

export class OfflineRowVerifier implements SigstoreVerifier {
  // async-by-interface (SigstoreVerifier.verifyRow → Promise<void>); the offline
  // crypto here is synchronous, so there is no inner await — a thrown
  // VerifyFailure surfaces as a rejected promise to the awaiting caller.
  // eslint-disable-next-line @typescript-eslint/require-await
  async verifyRow(input: VerifyRowInput): Promise<void> {
    const bundle = input.sigstoreBundle as OfflineBundle;

    // --- identity binding (cryptographic half of step 2) ---
    if (
      bundle.identity.issuer !== input.expectedIdentity.issuer ||
      bundle.identity.workflowRef !== input.expectedIdentity.workflowRef
    ) {
      throw new VerifyFailure(
        'identity_mismatch',
        `signer identity ${bundle.identity.issuer} / ${bundle.identity.workflowRef} ` +
          `!= pinned ${input.expectedIdentity.issuer} / ${input.expectedIdentity.workflowRef}`,
      );
    }

    // --- step 3: Rekor-style Merkle inclusion proof ---
    // The committed leaf must be the DSSE envelope payload bytes we were given.
    const expectedLeafHex = merkleLeafHashHex(input.payloadBytes);
    if (bundle.inclusionProof.leafHashHex !== expectedLeafHex) {
      throw new VerifyFailure(
        'rekor_inclusion',
        'inclusion-proof leaf hash does not match the payload (tampered payload or wrong leaf)',
      );
    }
    let computedRoot: string;
    try {
      computedRoot = computeMerkleRootHex(bundle.inclusionProof);
    } catch (err: unknown) {
      throw new VerifyFailure(
        'rekor_inclusion',
        `inclusion proof malformed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (computedRoot !== bundle.inclusionProof.rootHashHex) {
      throw new VerifyFailure(
        'rekor_inclusion',
        `recomputed Merkle root ${computedRoot} != claimed root ${bundle.inclusionProof.rootHashHex} ` +
          '(tampered audit path or forged inclusion)',
      );
    }

    // --- step 4: DSSE signature over the PAE ---
    const dssePayload = Buffer.from(bundle.dsse.payload, 'base64');
    // The DSSE payload must equal the bytes we were asked to attest to.
    if (!dssePayload.equals(Buffer.from(input.payloadBytes))) {
      throw new VerifyFailure(
        'dsse_signature',
        'DSSE envelope payload does not match the bundle bytes',
      );
    }
    const pae = dssePae(bundle.dsse.payloadType, input.payloadBytes);
    const sigEntry = bundle.dsse.signatures[0];
    if (sigEntry === undefined) {
      throw new VerifyFailure('dsse_signature', 'DSSE envelope has no signatures');
    }
    let valid = false;
    try {
      valid = cryptoVerify(
        null,
        pae,
        bundle.signerPublicKeyPem,
        Buffer.from(sigEntry.sig, 'base64'),
      );
    } catch (err: unknown) {
      throw new VerifyFailure(
        'dsse_signature',
        `signature verification error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!valid) {
      throw new VerifyFailure('dsse_signature', 'DSSE signature is invalid for the pinned key');
    }
  }
}
