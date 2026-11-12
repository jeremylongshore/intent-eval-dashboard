import { bundleFromJSON, isBundleWithDsseEnvelope } from '@sigstore/bundle';
import { type SigstoreVerifier, type VerifyRowInput, VerifyFailure } from '../ingest/interfaces.js';
import { SigstoreRowVerifier } from '../ingest/verifier-sigstore.js';

/** Private format admission and redaction; common cryptographic policy has one owner. */
export class PrivateRowVerifier implements SigstoreVerifier {
  async verifyRow(input: VerifyRowInput): Promise<void> {
    try {
      if (!isBundleWithDsseEnvelope(bundleFromJSON(input.sigstoreBundle))) {
        throw new VerifyFailure('dsse_signature', 'private_dsse_required');
      }
    } catch (error) {
      if (error instanceof VerifyFailure) throw error;
      throw new VerifyFailure('dsse_signature', 'private_bundle_invalid');
    }
    try {
      await new SigstoreRowVerifier().verifyRow(input);
    } catch (error) {
      throw new VerifyFailure(
        error instanceof VerifyFailure ? error.kind : 'dsse_signature',
        'private_verification_failed',
      );
    }
  }
}
