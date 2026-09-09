/**
 * Test fixtures that mint REAL signed bundles with REAL crypto.
 *
 * These build:
 *   - a kernel-schema-VALID EvidenceBundle payload (passes step 5 for real);
 *   - a REAL Ed25519 DSSE signature over the DSSE PAE (verified for real at
 *     step 4 by `OfflineRowVerifier`);
 *   - a REAL RFC-6962 Merkle inclusion proof whose recomputed root matches the
 *     claimed root (verified for real at step 3).
 *
 * Tampering with any of these (payload, audit path, signature, identity) makes
 * the corresponding crypto fail for real — which is the whole point of the
 * synthetic-attack tests. Nothing here is a no-op.
 *
 * This file lives under src/ so vitest's coverage `include: ['src/**']` does not
 * drag fixtures into the floor — it is matched by the `*.test.ts`-adjacent
 * exclusion? No — fixtures are not test files, so we exclude __fixtures__ in
 * vitest.config.ts. (Kept under src so NodeNext relative imports resolve.)
 */

import { generateKeyPairSync, sign as cryptoSign, createHash, randomBytes } from 'node:crypto';
import { canonicalJsonBytes, sha256Key } from '../content-address.js';
import { dssePae, merkleLeafHashHex } from '../verifier-offline.js';
import { type ManifestRow, type ManifestSigningClaims, type ReportManifest } from '../manifest.js';
import { type OfflineBundle } from '../verifier-offline.js';

const ISSUER = 'https://token.actions.githubusercontent.com';

/**
 * Pinned-allowlist-conformant signing claims for a repo. `_repo` is accepted for
 * call-site symmetry with the other minters but the claims key off `githubRepo`.
 */
export function signingClaimsFor(_repo: string, githubRepo: string): ManifestSigningClaims {
  return {
    issuer: ISSUER,
    subject: `repo:${githubRepo}:ref:refs/tags/v0.2.0`,
    workflowRef: `${githubRepo}/.github/workflows/release.yml@refs/tags/v0.2.0`,
  };
}

/** A valid kernel gate-result/v1 predicate body. */
export function validGateResult(): Record<string, unknown> {
  return {
    gate_id: 'j-rig:ci:gate-7-layer',
    gate_name: 'gate-7-layer',
    gate_version: '1.0.0',
    gate_decision: 'pass',
    gate_reasons: ['all layers passed'],
    coverage: { dimensions_evaluated: ['seven-layer'], dimensions_skipped: [] },
    policy_ref: `sha256:${'c'.repeat(64)}:policy`,
    policy_hash: `sha256:${'c'.repeat(64)}`,
    input_hash: `sha256:${'a'.repeat(64)}`,
    evaluated_at: '2026-05-30T12:00:00.000Z',
    runner: 'fixture@1.0.0',
    commit_sha: 'd'.repeat(40),
  };
}

/** A valid, kernel-schema-conformant EvidenceBundle manifest. */
export function validEvidenceBundle(
  gateResult: Record<string, unknown> = validGateResult(),
): Record<string, unknown> {
  const gateId = String(gateResult['gate_id']);
  const inputHash = String(gateResult['input_hash']).replace(/^sha256:/, '');
  return {
    // UUIDv7 (version nibble 7, variant 8/9/a/b)
    id: '01890a5d-ac96-774b-bcce-b302099a8057',
    eval_run_id: '01890a5d-ac96-774b-bcce-b302099a8058',
    created_at: '2026-05-30T12:00:00.000Z',
    predicate_uri_set: ['https://evals.intentsolutions.io/gate-result/v1'],
    row_count: 1,
    subject_set: [
      {
        name: gateId,
        digest: { sha256: inputHash },
      },
    ],
    // Existing producer v1 contract: one body per bundle, with the canonical
    // body digest committed through the signed storage_key.
    storage_key: sha256Key(canonicalJsonBytes(gateResult)),
    signing_mode: 'rekor_production',
    rekor_log_indices: [1689291334],
    verification_status: 'verified',
    verification_last_checked_at: '2026-05-30T12:00:01.000Z',
  };
}

/** Build a single Merkle tree over N leaves and return root + audit path for one. */
function buildMerkleProof(
  leafHashesHex: string[],
  leafIndex: number,
): { rootHashHex: string; auditPathHex: string[]; treeSize: number } {
  const NODE_PREFIX = Buffer.from([0x01]);
  function nodeHash(leftHex: string, rightHex: string): string {
    return createHash('sha256')
      .update(
        Buffer.concat([NODE_PREFIX, Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex')]),
      )
      .digest('hex');
  }
  const treeSize = leafHashesHex.length;
  let level = [...leafHashesHex];
  let index = leafIndex;
  let size = treeSize;
  const auditPath: string[] = [];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : undefined;
      if (right === undefined) {
        // odd node carries up unchanged (RFC 6962)
        next.push(left);
      } else {
        next.push(nodeHash(left, right));
      }
    }
    // record the sibling for our index
    if (index % 2 === 1) {
      auditPath.push(level[index - 1]!);
    } else if (index + 1 < level.length) {
      auditPath.push(level[index + 1]!);
    }
    index = Math.floor(index / 2);
    size = Math.floor((size + 1) / 2);
    level = next;
  }
  return { rootHashHex: level[0]!, auditPathHex: auditPath, treeSize };
}

export interface MintedRow {
  readonly row: ManifestRow;
  readonly publicKeyPem: string;
  readonly payloadBytes: Uint8Array;
}

/**
 * Mint one fully-signed manifest row for `repo`. The DSSE signature + Merkle
 * inclusion proof are real and self-consistent.
 *
 * Options let a test tamper with exactly one thing to prove a real failure.
 */
export function mintRow(
  repo: string,
  githubRepo: string,
  opts: {
    readonly bundle?: Record<string, unknown>;
    readonly sourceSha?: string;
    /** Override the identity baked into the offline bundle (for identity-mismatch test). */
    readonly identityOverride?: { issuer: string; workflowRef: string };
    /** Number of sibling leaves to put in the Merkle tree (>=1). */
    readonly siblingLeaves?: number;
    /** Adjacent predicate bodies committed to by the bundle metadata. */
    readonly gateResults?: readonly unknown[];
  } = {},
): MintedRow {
  const gateResults = opts.gateResults ?? [validGateResult()];
  const firstGateResult = gateResults[0];
  const bundle =
    opts.bundle ??
    validEvidenceBundle(
      firstGateResult !== null &&
        typeof firstGateResult === 'object' &&
        !Array.isArray(firstGateResult)
        ? (firstGateResult as Record<string, unknown>)
        : validGateResult(),
    );
  const payloadBytes = canonicalJsonBytes(bundle);
  const payloadB64 = Buffer.from(payloadBytes).toString('base64');
  const payloadType = 'application/vnd.in-toto+json';

  // Real Ed25519 keypair + signature over the DSSE PAE.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pae = dssePae(payloadType, payloadBytes);
  const sig = cryptoSign(null, pae, privateKey).toString('base64');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  // Real Merkle tree: our leaf + some random sibling leaves.
  const ourLeafHex = merkleLeafHashHex(payloadBytes);
  const siblingCount = opts.siblingLeaves ?? 1;
  const siblingLeaves = Array.from({ length: siblingCount }, () =>
    merkleLeafHashHex(randomBytes(32)),
  );
  const leaves = [ourLeafHex, ...siblingLeaves];
  const { rootHashHex, auditPathHex, treeSize } = buildMerkleProof(leaves, 0);

  const claims = signingClaimsFor(repo, githubRepo);
  const offline: OfflineBundle = {
    dsse: {
      payloadType,
      payload: payloadB64,
      signatures: [{ sig }],
    },
    inclusionProof: {
      leafHashHex: ourLeafHex,
      leafIndex: 0,
      treeSize,
      auditPathHex,
      rootHashHex,
    },
    signerPublicKeyPem: publicKeyPem,
    identity: opts.identityOverride ?? {
      issuer: claims.issuer,
      workflowRef: claims.workflowRef,
    },
  };

  return {
    row: {
      bundle,
      sigstoreBundle: offline,
      sourceSha: opts.sourceSha ?? 'a'.repeat(40),
      gateResults,
    },
    publicKeyPem,
    payloadBytes,
  };
}

/** Build a complete valid manifest for a repo with `rowCount` minted rows. */
export function mintManifest(repo: string, githubRepo: string, rowCount = 1): ReportManifest {
  const rows = Array.from({ length: rowCount }, () => mintRow(repo, githubRepo).row);
  return {
    repo,
    signing: signingClaimsFor(repo, githubRepo),
    rows,
  };
}

/** The 8 ingest repos mapped to their GitHub repo paths (matches pinned-subjects). */
export const REPO_GITHUB: Readonly<Record<string, string>> = {
  iec: 'jeremylongshore/intent-eval-core',
  iel: 'jeremylongshore/intent-eval-lab',
  iah: 'jeremylongshore/intent-audit-harness',
  iaj: 'jeremylongshore/j-rig-skill-binary-eval',
  iar: 'jeremylongshore/intent-rollout-gate',
  ccp: 'jeremylongshore/claude-code-plugins-plus-skills',
  // jrig = the SECOND ingest channel on j-rig-skill-binary-eval (nightly
  // skill-eval roster); iaj covers the same repo's tag-based release channel.
  jrig: 'jeremylongshore/j-rig-skill-binary-eval',
  // qmd = the governed brain's registrar repo, renamed 2026-07-19 from
  // qmd-team-intent-kb to bobs-big-brain-registrar.
  qmd: 'jeremylongshore/bobs-big-brain-registrar',
};
