/**
 * Retraction denylist — the `retractions.json` file format + its validator.
 *
 * This is the OPERATOR-FACING input to the retraction protocol (bead puxu.10).
 * It is NOT the kernel `retraction/v1` predicate body — that contract lives in
 * `@intentsolutions/core` and is imported, never redefined here. The denylist is
 * the local, internal list of subjects the platform has chosen to stop
 * surfacing; from each entry we DERIVE a signed `retraction/v1` Statement
 * (see `statement.ts`), a Caddy 410 directive (see `snippet.ts`) and a public
 * tombstone page (see `tombstone.ts`).
 *
 * HARD BINDINGS enforced HERE (GC + CISO refusals — DR-035 § 8):
 *
 *   1. **Closed-set `reason_class` ONLY.** The set is exactly the kernel's
 *      `RetractionReasonClass` enum: `partner-request`, `methodology-error`,
 *      `data-quality`, `consent-withdrawn`, `legal-hold`,
 *      `pre-publication-recall`. Open-text / free-form reasons are REJECTED.
 *      We source the enum FROM the kernel validator so the denylist can never
 *      drift from the signed predicate body (single source of truth). (GC.)
 *   2. **Every entry resolves to a concrete subject.** Exactly the same
 *      at-least-one-reference rule the kernel enforces: a denylist entry MUST
 *      carry at least one of `bundle_id`, `storage_key`, `content_hash`. We add
 *      a denylist-only `deep_url_path` for the public deep link that gets the
 *      410 + tombstone (the kernel body has no URL field — that is a rendering
 *      concern, not a predicate concern). A `deep_url_path` alone is NOT a
 *      sufficient subject reference: it pins WHERE we serve the 410, not WHICH
 *      signed artifact is retracted.
 *
 * The validator is the deterministic gate: it rejects an out-of-set
 * `reason_class`, a subject-less entry, an unsafe `deep_url_path`, and any
 * unknown/extra field (strict). Malformed entries are reported with a path so an
 * operator can fix the file before regeneration.
 */

import { z } from 'zod';
// Source the closed-set reason class FROM THE KERNEL so the denylist enum can
// never drift from the signed predicate body. The kernel is the source of truth.
import { RetractionReasonClassSchema } from '@intentsolutions/core/validators/v1/retraction-v1';

/**
 * The closed-set reason class, inferred FROM the kernel schema (not hand-typed)
 * so it can never drift from the signed predicate body.
 */
export type RetractionReasonClass = z.infer<typeof RetractionReasonClassSchema>;

/**
 * The public deep-URL path that receives the 410 + tombstone, e.g.
 * `/results/iec/0190b8e5.../`. MUST be an absolute, single-line, traversal-free
 * site path so it can be templated safely into both a Caddy matcher and a
 * filesystem tombstone location. Query strings / fragments / `..` are rejected.
 */
const DeepUrlPathSchema = z
  .string()
  .regex(
    /^\/[A-Za-z0-9._~\-/]*$/,
    'deep_url_path MUST be an absolute site path (start with "/", no spaces, no query/fragment, no "..")',
  )
  .refine((p) => !p.includes('..'), {
    message: 'deep_url_path MUST NOT contain a path-traversal segment ("..")',
  });

/**
 * One denylist entry. `.strict()` rejects unknown fields so a typo'd key
 * (e.g. `reasonClass`) fails loudly instead of being silently ignored. The
 * `.refine()` mirrors the kernel's at-least-one-subject rule.
 */
export const RetractionEntrySchema = z
  .object({
    /** UUIDv7 of the retracted EvidenceBundle (FK → EvidenceBundle.id). */
    bundle_id: z.string().min(1).optional(),
    /** Content-addressed object-storage key of the retracted bundle payload. */
    storage_key: z.string().min(1).optional(),
    /** sha256-prefixed digest pinning the exact retracted content. */
    content_hash: z.string().min(1).optional(),
    /**
     * Public deep-URL path that should return 410 Gone + serve the tombstone.
     * Denylist-only (NOT part of the kernel predicate body): it pins WHERE we
     * stop serving, derived from the bundle's published results deep link.
     */
    deep_url_path: DeepUrlPathSchema,
    /** Closed-set reason class — sourced from the kernel enum. */
    reason_class: RetractionReasonClassSchema,
    /** RFC-3339 UTC timestamp at which the retraction took effect. */
    retracted_at: z.string().min(1),
    /**
     * OPTIONAL internal note (operator context). Surfaced on the tombstone +
     * carried into the predicate body's optional `reason` field. MUST NOT be
     * parsed for decisions — `reason_class` is the machine-actionable signal.
     */
    note: z.string().optional(),
    /**
     * OPTIONAL actor identity that authored the retraction, for audit trail.
     * Carried into the predicate body's optional `retracted_by`.
     */
    retracted_by: z.string().optional(),
  })
  .strict()
  .refine(
    (e) => e.bundle_id !== undefined || e.storage_key !== undefined || e.content_hash !== undefined,
    {
      message:
        'a retraction entry MUST carry at least one signed-subject reference (bundle_id, storage_key, or content_hash) — a deep_url_path alone is not a subject',
      path: ['retracted_subject'],
    },
  );

/** A single, validated denylist entry. */
export type RetractionEntry = z.infer<typeof RetractionEntrySchema>;

/**
 * The whole `retractions.json` file: an array of entries. An empty array is a
 * VALID, fully-functional state (no retractions yet) — it produces an empty/
 * no-op snippet and zero tombstones.
 */
export const RetractionDenylistSchema = z.array(RetractionEntrySchema);

/** The validated denylist. */
export type RetractionDenylist = z.infer<typeof RetractionDenylistSchema>;

/** A structured validation failure for one entry (for operator-facing errors). */
export interface DenylistValidationIssue {
  /** Index into the array (or -1 if the top-level value is not an array). */
  readonly index: number;
  /** Dotted path of the offending field within the entry. */
  readonly path: string;
  /** Human-readable reason. */
  readonly message: string;
}

/** Result of validating a parsed-but-untrusted denylist value. */
export type DenylistValidationResult =
  | { readonly ok: true; readonly denylist: RetractionDenylist }
  | { readonly ok: false; readonly issues: readonly DenylistValidationIssue[] };

/**
 * Validate an untrusted value (e.g. `JSON.parse(retractions.json)`) against the
 * denylist schema. Pure + total — never throws on bad input; returns a
 * structured result so callers (the generator + CI) can fail closed with a
 * readable diagnostic.
 *
 * REJECTS:
 *   - a non-array top-level value
 *   - an out-of-set `reason_class` (the GC closed-set binding)
 *   - an entry with NO signed-subject reference
 *   - an unsafe / non-absolute `deep_url_path`
 *   - any unknown / extra field (strict)
 */
export function validateDenylist(value: unknown): DenylistValidationResult {
  const parsed = RetractionDenylistSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, denylist: parsed.data };
  }
  const issues: DenylistValidationIssue[] = parsed.error.issues.map((issue) => {
    // Zod path for an array element starts with its numeric index.
    const first = issue.path[0];
    const index = typeof first === 'number' ? first : -1;
    const fieldPath = issue.path.slice(typeof first === 'number' ? 1 : 0).join('.') || '(entry)';
    return { index, path: fieldPath, message: issue.message };
  });
  return { ok: false, issues };
}
