/**
 * Production sigstore verifier — steps 3 (Rekor inclusion) + 4 (DSSE signature)
 * + cryptographic binding of step 2's pinned identity.
 *
 * REAL verification via sigstore-js. `sigstore.verify(bundle, payload, opts)`:
 *   - verifies the DSSE envelope signature against the Fulcio leaf cert (step 4);
 *   - verifies the Rekor transparency-log inclusion proof — forced by
 *     `tlogThreshold: 1` (step 3);
 *   - enforces the signing-certificate identity against the pinned OIDC
 *     issuer + subject (`certificateIssuer` + `certificateIdentityURI`) — the
 *     cryptographic half of step 2.
 *
 * There is NO no-op path. If the bundle can't be verified for real, this throws
 * a {@link VerifyFailure} and the worker crashes (fail-closed). This is the
 * default consumers get unless they inject another verifier.
 */

import { verify as sigstoreVerify } from 'sigstore';
import { type SerializedBundle } from '@sigstore/bundle';
import {
  type SigstoreVerifier,
  type VerifyRowInput,
  VerifyFailure,
} from './interfaces.js';

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
  return `https://github.com/${workflowRef}`;
}

export class SigstoreRowVerifier implements SigstoreVerifier {
  /**
   * @param tlogThreshold minimum number of verified transparency-log entries
   *   (inclusion proofs) required. Default 1 — REAL Rekor inclusion-proof
   *   verification is mandatory; setting this to 0 would defeat step 3 and is
   *   therefore not the default.
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
          : /IDENTITY|CERTIFICATE_ERROR|POLICY/i.test(code) || /identity|subject|issuer/i.test(message)
            ? 'identity_mismatch'
            : 'dsse_signature';
      throw new VerifyFailure(kind, `sigstore verification failed (${code || 'unknown'}): ${message}`);
    }
  }
}
