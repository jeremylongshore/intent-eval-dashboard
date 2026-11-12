import { canonicalJsonBytes, sha256Key } from '../ingest/content-address.js';
import type { PrivateConfig } from './config.js';

/** Advance when authentication policy changes; never supplied by enrollment data. */
export const PRIVATE_POLICY_GENERATION = 'private-dsse-auth-v1';

/** Entire enrollment is conservative: token values are never part of this input. */
export function privateConfigFingerprint(config: PrivateConfig, policyGeneration: string): string {
  return sha256Key(canonicalJsonBytes({ policyGeneration, config })).slice('sha256:'.length);
}

export function privateGeneration(config: PrivateConfig): string {
  return `${PRIVATE_POLICY_GENERATION}/${privateConfigFingerprint(config, PRIVATE_POLICY_GENERATION)}`;
}
