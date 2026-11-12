/**
 * Production sigstore verifier — steps 3 (Rekor inclusion) + 4 (DSSE signature)
 * + cryptographic binding of step 2's pinned identity.
 *
 * REAL verification via sigstore-js. `sigstore.verify(bundle, payload, opts)`:
 *   - verifies the DSSE envelope signature against the Fulcio leaf cert (step 4);
 *   - authenticates every supplied transparency entry; this adapter additionally
 *     requires actual inclusion proofs/checkpoints, not promises (step 3);
 *   - enforces the signing-certificate identity against the pinned OIDC
 *     issuer + subject (`certificateIssuer` + `certificateIdentityURI`) — the
 *     cryptographic half of step 2.
 *
 * There is NO no-op path. If the bundle can't be verified for real, this throws
 * a {@link VerifyFailure} and the worker crashes (fail-closed). This is the
 * default consumers get unless they inject another verifier.
 */

import { verify as sigstoreVerify } from 'sigstore';
import { bundleFromJSON, type Bundle, type SerializedBundle } from '@sigstore/bundle';
import { type SigstoreVerifier, type VerifyRowInput, VerifyFailure } from './interfaces.js';

/**
 * Map the pinned GitHub OIDC subject to the certificate identity URI sigstore
 * checks. For GitHub Actions, the SAN URI on the Fulcio cert is the
 * `workflow_ref` (`https://github.com/OWNER/REPO/.github/workflows/FILE@REF`),
 * and the issuer extension is the OIDC issuer. We bind to the workflow_ref URI
 * (the SAN) and the issuer; the manifest's `subject` is additionally checked in
 * the pure step-2 allowlist pass.
 */
function workflowRefToSanUri(workflowRef: string): string {
  // workflowRef form: OWNER/REPO/.github/workflows/FILE@REF
  const literal = `https://github.com/${workflowRef}`;
  // Sigstore treats this string as a regex. Match every literal byte, including
  // strict end-of-input: JavaScript $ alone also accepts before a final newline.
  return `^${literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\s\\S])`;
}

/** Metadata consistency after the vetted library authenticates every entry.
 * Checkpoint wire format: transparency-dev/formats@1973a275 log/README.md.
 * Signature and Merkle calculations remain exclusively in Sigstore.
 */
function requireInclusionProofs(bundle: Bundle): void {
  const entries = bundle.verificationMaterial.tlogEntries;
  if (entries.length === 0) throw new Error('Rekor inclusion proof required');
  for (const entry of entries) {
    const proof = entry.inclusionProof;
    if (!proof?.checkpoint?.envelope)
      throw new Error('Rekor inclusion proof and checkpoint required');
    const [, size, root] = proof.checkpoint.envelope.split('\n');
    const decimal = /^(0|[1-9][0-9]*)(?![\s\S])/;
    if (
      !size ||
      !decimal.test(size) ||
      !decimal.test(proof.treeSize) ||
      !root ||
      Buffer.from(root, 'base64').toString('base64') !== root ||
      BigInt(size) !== BigInt(proof.treeSize) ||
      !Buffer.from(root, 'base64').equals(proof.rootHash)
    ) {
      throw new Error('Rekor inclusion proof metadata differs from authenticated checkpoint');
    }
  }
}

export class SigstoreRowVerifier implements SigstoreVerifier {
  /**
   * @param tlogThreshold minimum number of verified transparency-log entries
   *   required by the library. Default 1. The adapter independently requires
   *   actual inclusion proofs/checkpoints for all supplied entries.
   */
  constructor(private readonly tlogThreshold = 1) {}

  async verifyRow(input: VerifyRowInput): Promise<void> {
    const bundle = input.sigstoreBundle as SerializedBundle;
    try {
      await sigstoreVerify(bundle, Buffer.from(input.payloadBytes), {
        tlogThreshold: this.tlogThreshold,
        certificateIssuer: input.expectedIdentity.issuer,
        certificateIdentityURI: workflowRefToSanUri(input.expectedIdentity.workflowRef),
      });
      // For DSSE, sigstore verifies its embedded payload and does not compare
      // the external artifact argument. Bind those authenticated bytes to the
      // exact metadata the worker will validate, content-address and persist.
      // MessageSignature bundles retain the library's existing blob binding.
      const verified = bundleFromJSON(bundle);
      requireInclusionProofs(verified);
      if (
        verified.content.$case === 'dsseEnvelope' &&
        !verified.content.dsseEnvelope.payload.equals(Buffer.from(input.payloadBytes))
      ) {
        throw new Error('DSSE payload does not match the consumed artifact bytes');
      }
    } catch (err: unknown) {
      // sigstore throws VerificationError with a `code` for the failing check.
      const message = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code ?? '';
      // Classify into the worker's step taxonomy. Identity + signature failures
      // map to the DSSE step; inclusion-proof / tlog failures to the Rekor step.
      const kind =
        /TLOG|INCLUSION|REKOR|TRANSPARENCY/i.test(code) ||
        /inclusion|transparency log|tlog/i.test(message)
          ? 'rekor_inclusion'
          : /IDENTITY|CERTIFICATE_ERROR|POLICY/i.test(code) ||
              /identity|subject|issuer/i.test(message)
            ? 'identity_mismatch'
            : 'dsse_signature';
      throw new VerifyFailure(
        kind,
        `sigstore verification failed (${code || 'unknown'}): ${message}`,
      );
    }
  }
}
