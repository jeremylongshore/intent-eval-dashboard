/**
 * Structured crash reasons for the 8-step ingest contract (DR-035 B1).
 *
 * When ANY verification step fails, the worker crashes with one of these. The
 * supervisor records it, and the renderer uses it to set
 * `last_known_good_stale_since` for the affected repo while continuing to serve
 * the PRIOR good snapshot (verify-before-render / fail-closed binding).
 *
 * The reason is a closed enum of `reason_code`s so the renderer + /status route
 * can classify failures without parsing free text.
 */

/** The 8 ordered steps of the per-worker B1 contract. */
export type IngestStep =
  | 'fetch_manifest' // 1
  | 'verify_oidc' // 2
  | 'verify_rekor_inclusion' // 3
  | 'verify_dsse_signature' // 4
  | 'validate_schema' // 5
  | 'content_address' // 6
  | 'emit_snapshot'; // 7

/** Closed-set machine-readable failure classes. */
export type IngestReasonCode =
  | 'manifest_unreachable'
  | 'manifest_malformed'
  | 'oidc_issuer_mismatch'
  | 'oidc_subject_mismatch'
  | 'oidc_workflow_ref_mismatch'
  | 'repo_not_in_allowlist'
  | 'rekor_inclusion_invalid'
  | 'dsse_signature_invalid'
  | 'schema_invalid'
  | 'content_address_failed'
  | 'snapshot_emit_failed';

/** The structured reason object carried by every ingest crash. */
export interface IngestReason {
  readonly repo: string;
  readonly step: IngestStep;
  readonly reasonCode: IngestReasonCode;
  readonly detail: string;
  /** Optional row index when the failure is row-specific (steps 3/4/5). */
  readonly rowIndex?: number;
}

/**
 * The error thrown by an ingest worker on any verification failure.
 *
 * Carries the structured {@link IngestReason}. The supervisor treats a thrown
 * `IngestCrash` as an abnormal exit and (for transient workers) restarts it;
 * the reason is preserved verbatim for `last_known_good_stale_since` bookkeeping.
 */
export class IngestCrash extends Error {
  public readonly reason: IngestReason;

  constructor(reason: IngestReason) {
    super(
      `ingest crash [${reason.repo}] step=${reason.step} code=${reason.reasonCode}` +
        (reason.rowIndex === undefined ? '' : ` row=${reason.rowIndex}`) +
        `: ${reason.detail}`,
    );
    this.name = 'IngestCrash';
    this.reason = reason;
  }
}

/** Type guard for {@link IngestCrash}. */
export function isIngestCrash(value: unknown): value is IngestCrash {
  return value instanceof IngestCrash;
}
