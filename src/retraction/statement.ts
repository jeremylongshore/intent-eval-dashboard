/**
 * retraction/v1 signed-Statement emission (bead puxu.10).
 *
 * Given a validated denylist entry, build the in-toto Statement v1 that wraps a
 * `retraction/v1` predicate body, and validate that body against the KERNEL's
 * `RetractionV1Schema`. The predicate URI is the kernel's `RETRACTION_V1_URI`
 * (`https://evals.intentsolutions.io/retraction/v1`) — NEVER `labs.*` (CISO
 * binding, DR-010 + DR-035 § 8).
 *
 * We build + validate the UNSIGNED Statement payload here. Actual sigstore
 * SIGNING (DSSE envelope, keyless OIDC, Rekor anchor) is the same CI path used
 * everywhere else in the platform — it is wired behind {@link RetractionSigner}
 * and is intentionally NOT faked. `signRetraction` with the default
 * {@link unsignedSigner} returns the canonicalized payload + an explicit
 * `signed: false` marker so a caller can never mistake an unsigned payload for a
 * signed attestation.
 *
 * Append-only honesty: a retraction does NOT delete the original attestation.
 * The original row stays in the Rekor transparency log; this Statement is an
 * APPEND-ONLY signed record that we have chosen not to surface it, and why.
 */

import {
  RetractionV1Schema,
  RETRACTION_V1_URI,
  type RetractionV1,
} from '@intentsolutions/core/validators/v1/retraction-v1';
import { type RetractionEntry } from './denylist.js';

/** Re-export the canonical kernel URI so consumers never hand-write the string. */
export { RETRACTION_V1_URI };

/** in-toto Statement v1 envelope wrapping a retraction/v1 predicate body. */
export interface RetractionStatement {
  readonly _type: 'https://in-toto.io/Statement/v1';
  readonly subject: readonly {
    readonly name: string;
    readonly digest: { readonly sha256: string };
  }[];
  readonly predicateType: typeof RETRACTION_V1_URI;
  readonly predicate: RetractionV1;
}

/**
 * Build the `retraction/v1` predicate BODY from a denylist entry, then validate
 * it against the kernel schema. Throws if the body does not satisfy the kernel
 * contract (it should not, since the denylist validator already enforced the
 * closed-set + at-least-one-subject rules — this is defence in depth).
 *
 * The `deep_url_path` is denylist-only (a rendering concern) and is deliberately
 * NOT carried into the predicate body, which has no URL field.
 */
export function buildRetractionPredicate(entry: RetractionEntry): RetractionV1 {
  // Assemble retracted_subject from whichever references the entry carries.
  // Built as one literal so exactOptionalPropertyTypes is satisfied (omit, not
  // assign-undefined) and no index-signature dotted access is needed.
  const subject: Record<string, string> = {
    ...(entry.bundle_id !== undefined ? { bundle_id: entry.bundle_id } : {}),
    ...(entry.storage_key !== undefined ? { storage_key: entry.storage_key } : {}),
    ...(entry.content_hash !== undefined ? { content_hash: entry.content_hash } : {}),
  };

  const body: Record<string, unknown> = {
    retracted_subject: subject,
    reason_class: entry.reason_class,
    retracted_at: entry.retracted_at,
    // The internal note maps to the predicate's OPTIONAL free-text `reason`.
    ...(entry.note !== undefined ? { reason: entry.note } : {}),
    ...(entry.retracted_by !== undefined ? { retracted_by: entry.retracted_by } : {}),
  };

  // Validate against the KERNEL schema — the single source of truth. This is the
  // load-bearing assertion: if the kernel rejects the body, we refuse to emit a
  // Statement at all rather than emit one the kernel would not sign.
  const parsed = RetractionV1Schema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`retraction/v1 predicate body failed kernel validation: ${detail}`);
  }
  return parsed.data;
}

/**
 * The in-toto subject name for a retraction Statement. Names the retracted
 * artifact so a reader of the Statement can see WHAT was retracted; the
 * structured `retracted_subject` in the predicate body is the
 * machine-resolvable reference for resolvers that do not parse subjects.
 */
function subjectName(entry: RetractionEntry): string {
  return entry.bundle_id ?? entry.storage_key ?? entry.content_hash ?? entry.deep_url_path;
}

/**
 * The subject digest. in-toto requires a `sha256` digest on each subject. When
 * the entry pins a `content_hash` of shape `sha256:<hex>` we surface the bare
 * hex; otherwise we leave it empty-string-flagged so the signer (CI) can fill it
 * from the resolved artifact. We never fabricate a digest.
 */
function subjectDigest(entry: RetractionEntry): { readonly sha256: string } {
  if (entry.content_hash?.startsWith('sha256:')) {
    return { sha256: entry.content_hash.slice('sha256:'.length) };
  }
  return { sha256: '' };
}

/**
 * Build the full UNSIGNED in-toto Statement wrapping a validated retraction/v1
 * predicate body. The predicate body is kernel-validated inside
 * {@link buildRetractionPredicate}.
 */
export function buildRetractionStatement(entry: RetractionEntry): RetractionStatement {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: subjectName(entry), digest: subjectDigest(entry) }],
    predicateType: RETRACTION_V1_URI,
    predicate: buildRetractionPredicate(entry),
  };
}

/**
 * Canonicalize a Statement to the deterministic JSON byte string that the DSSE
 * pre-authentication encoding signs over. Stable key ordering so the payload is
 * reproducible (the same entry always produces the same bytes).
 */
export function canonicalizeStatement(stmt: RetractionStatement): string {
  return JSON.stringify(sortKeysDeep(stmt));
}

/** Recursively sort object keys for a deterministic serialization. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeysDeep(record[key]);
    }
    return out;
  }
  return value;
}

/**
 * A keyless-CI retraction signer. The real implementation is the same sigstore
 * keyless path used elsewhere in the platform (OIDC → Fulcio cert → DSSE →
 * Rekor). This interface is the seam: production wires a sigstore-backed signer;
 * local generation uses {@link unsignedSigner}, which returns the canonical
 * payload WITHOUT a signature and marks it explicitly.
 */
export interface RetractionSigner {
  /**
   * Sign the canonicalized Statement payload. Returns either a real DSSE
   * envelope (`signed: true`) or — for the unsigned path — the canonical payload
   * with `signed: false`.
   */
  sign(statement: RetractionStatement): Promise<SignedRetraction>;
}

/** The output of a (real or unsigned) retraction signing operation. */
export type SignedRetraction =
  | {
      /** A real DSSE-signed + Rekor-anchored retraction. */
      readonly signed: true;
      readonly statement: RetractionStatement;
      /** Opaque DSSE envelope (base64 payload + signatures), produced by sigstore. */
      readonly dsseEnvelope: string;
      /** Rekor log index of the inclusion proof. */
      readonly rekorLogIndex: number;
    }
  | {
      /** The UNSIGNED payload — explicitly NOT a signature. */
      readonly signed: false;
      readonly statement: RetractionStatement;
      /** Canonical payload bytes the production signer would sign over. */
      readonly canonicalPayload: string;
      /** Why no signature is present (so this can never be mistaken for signed). */
      readonly reason: 'no-signer-wired';
    };

/**
 * The default, NON-FAKING signer used by local generation + tests. It builds and
 * validates the Statement and returns the canonical payload with an explicit
 * `signed: false`. It does NOT invent a signature, a cert, or a Rekor index.
 */
export const unsignedSigner: RetractionSigner = {
  sign(statement: RetractionStatement): Promise<SignedRetraction> {
    return Promise.resolve({
      signed: false,
      statement,
      canonicalPayload: canonicalizeStatement(statement),
      reason: 'no-signer-wired',
    });
  },
};

/**
 * Build the Statement for a denylist entry and run it through a signer.
 * Defaults to the {@link unsignedSigner} so callers that have not wired sigstore
 * still get a kernel-validated, canonicalized payload — never a faked signature.
 */
export async function signRetraction(
  entry: RetractionEntry,
  signer: RetractionSigner = unsignedSigner,
): Promise<SignedRetraction> {
  const statement = buildRetractionStatement(entry);
  return signer.sign(statement);
}
