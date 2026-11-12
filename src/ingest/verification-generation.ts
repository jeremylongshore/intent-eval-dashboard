/** Store namespaces are policy isolation, not retroactive signature verification. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { canonicalJsonBytes } from './content-address.js';
import type { RenderInput, RepoPassOutcome } from './renderer.js';
import type { PinnedSubjects } from './oidc-allowlist.js';

export const PUBLIC_POLICY_GENERATION = 'public-sigstore-auth-v1';
export const GENERATION_MARKER = '.verification-generation.json';
export interface VerificationGeneration {
  readonly policyGeneration: string;
  readonly configurationDigest: string;
}
export function publicVerificationGeneration(config: PinnedSubjects): VerificationGeneration {
  return {
    policyGeneration: PUBLIC_POLICY_GENERATION,
    configurationDigest: createHash('sha256')
      .update(canonicalJsonBytes({ policyGeneration: PUBLIC_POLICY_GENERATION, config }))
      .digest('hex'),
  };
}
export function generationSelector(generation: VerificationGeneration): string {
  if (
    generation.policyGeneration !== PUBLIC_POLICY_GENERATION ||
    !/^[a-f0-9]{64}(?![\s\S])/.test(generation.configurationDigest)
  ) {
    throw new Error('invalid public verification generation');
  }
  return `${generation.policyGeneration}/${generation.configurationDigest}`;
}
export function generationStoreRoot(root: string, generation: VerificationGeneration): string {
  return join(root, generationSelector(generation));
}
/** Artifact state only: this is deliberately not a deployed-activation receipt. */
export function artifactMarker(generation: VerificationGeneration, sourceRevision: string): string {
  generationSelector(generation);
  return (
    JSON.stringify(
      {
        schema: 'dashboard-artifact-generation/v1',
        ...generation,
        sourceRevision,
        state: 'prepared-artifact',
      },
      null,
      2,
    ) + '\n'
  );
}
export async function hasCurrentArtifactGeneration(
  root: string,
  expected: VerificationGeneration,
): Promise<boolean> {
  generationSelector(expected);
  try {
    const marker = join(root, GENERATION_MARKER);
    if (!(await lstat(marker)).isFile())
      throw new Error('generation marker must be a regular file');
    const value: unknown = JSON.parse(await readFile(marker, 'utf8'));
    return (
      typeof value === 'object' &&
      value !== null &&
      'schema' in value &&
      value.schema === 'dashboard-artifact-generation/v1' &&
      'state' in value &&
      value.state === 'prepared-artifact' &&
      'policyGeneration' in value &&
      value.policyGeneration === expected.policyGeneration &&
      'configurationDigest' in value &&
      value.configurationDigest === expected.configurationDigest
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Fresh worker success with zero rows is not cryptographic activation evidence. */
export function newlyVerifiedRepoCount(
  input: RenderInput,
  outcomes: readonly RepoPassOutcome[],
): number {
  const fresh = new Set(outcomes.filter((outcome) => outcome.fresh).map((outcome) => outcome.repo));
  return input.repos.filter(
    (repo) => fresh.has(repo.repo) && (repo.snapshot?.bundleKeys.length ?? 0) > 0,
  ).length;
}
