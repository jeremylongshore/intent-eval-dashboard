/**
 * C3 binding scanner — refuse cross-predicate aggregate PASS%.
 *
 * The hard integrity binding (DR-035 § 4 C3; CTO + CMO + VP DevRel independent
 * refusals): the rendered output must NEVER contain a laundered aggregate pass
 * metric. Specifically — any rendered text matching `<X>/<N> pass` or `<X>%
 * pass` that spans MULTIPLE distinct predicate URIs is FORBIDDEN. A count
 * scoped to a SINGLE predicate URI is acceptable (it is not laundering: the
 * predicate semantics are homogeneous).
 *
 * This module is the deterministic detector. It is consumed by:
 *   - `scripts/lint-no-aggregate-pass.ts` (the CI gate that exits non-zero), and
 *   - the synthetic C3 test (clean fixture passes; aggregate-across-two-predicate
 *     fixture fails).
 *
 * Detection model
 * ───────────────
 * 1. Find every aggregate-PASS% token: `<digits>/<digits> pass` or
 *    `<digits>% pass` (case-insensitive, whitespace-tolerant).
 * 2. For each hit, count the DISTINCT predicate URIs referenced in the same
 *    enclosing GROUPING scope. The grouping units are the elements the renderer
 *    actually uses to group results: `<li>`, `<tr>`, and `<section>`. The scope
 *    runs from the nearest enclosing grouping-open at or before the hit to the
 *    next grouping-open after it (bounded by a window). If the hit's scope
 *    references >= 2 distinct predicate URIs, it is a CROSS-PREDICATE aggregate
 *    → VIOLATION.
 * 3. A hit whose grouping scope references 0 or 1 predicate URIs is
 *    predicate-free prose or a single-predicate count → allowed.
 *
 * Conservatism: when NO grouping element encloses the hit (scopeStart falls back
 * to document start) AND the whole document references >= 2 predicate URIs, the
 * hit is treated as a violation. This is fail-closed: a laundered metric that
 * is not wrapped in any grouping element must not slip through on a page that
 * mixes predicates.
 */

/** A predicate URI lives at evals.intentsolutions.io/<name>/v<N>. */
const PREDICATE_URI_RE = /evals\.intentsolutions\.io\/[a-z][a-z0-9-]*\/v[0-9]+/gi;

/** Aggregate-PASS% tokens: `X/N pass` or `X% pass` (whitespace-tolerant). */
const AGGREGATE_PASS_RE = /[0-9]+\s*\/\s*[0-9]+\s+pass\b|[0-9]+\s*%\s+pass\b/gi;

/**
 * Grouping-level boundaries that delimit a "scope" for predicate counting.
 * These are the elements the results renderer uses to group rows/counts —
 * deliberately NOT `<p>`/`<td>`/`<div>`, which are too granular and would split
 * a legitimate single-predicate count from the URI it belongs to.
 */
function scopeOpenRe(): RegExp {
  return /<(li|tr|section)\b[^>]*>/gi;
}

/** A single C3 violation found in some text. */
export interface C3Violation {
  /** The offending aggregate-PASS% snippet. */
  readonly match: string;
  /** Distinct predicate URIs seen in the offending scope. */
  readonly predicateUris: readonly string[];
  /** Character offset of the match in the scanned text. */
  readonly index: number;
  /** Short scope excerpt around the match (for the error message). */
  readonly excerpt: string;
}

/** Distinct predicate URIs referenced within `text`. */
function distinctPredicateUris(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PREDICATE_URI_RE)) {
    found.add(m[0].toLowerCase());
  }
  return [...found];
}

/**
 * Find the enclosing-scope substring for a match at `matchIndex`.
 *
 * We take the text from the START of the nearest preceding block-open tag to a
 * bounded window after the match (so a per-predicate `<li>` count is scoped to
 * its own `<li>`, not the whole list). If no block-open precedes it, we use the
 * whole document (fail-closed widening).
 */
function scopeFor(text: string, matchIndex: number): { scope: string; enclosed: boolean } {
  // Collect every grouping-open tag position once (fresh regex — no shared state).
  const opens: number[] = [];
  const re = scopeOpenRe();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    opens.push(m.index);
    // Guard against zero-width matches advancing the cursor.
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }

  // Nearest grouping-open at or before the match => scope start. `enclosed`
  // records whether any grouping element actually wraps the hit.
  let scopeStart = 0;
  let enclosed = false;
  for (const pos of opens) {
    if (pos <= matchIndex) {
      scopeStart = pos;
      enclosed = true;
    } else {
      break;
    }
  }

  // Scope end: the FIRST grouping-open strictly after the match (so a
  // per-predicate <li>/<tr> count is scoped to its own group), bounded by a
  // +400 window.
  const windowEnd = Math.min(text.length, matchIndex + 400);
  let scopeEnd = windowEnd;
  for (const pos of opens) {
    if (pos > matchIndex) {
      scopeEnd = Math.min(pos, windowEnd);
      break;
    }
  }
  return { scope: text.slice(scopeStart, scopeEnd), enclosed };
}

/**
 * Scan one text blob (HTML) for cross-predicate aggregate-PASS% violations.
 *
 * Returns every violation found. An empty array means the text is C3-clean.
 */
export function scanForAggregatePass(text: string): C3Violation[] {
  const violations: C3Violation[] = [];
  const docUriCount = distinctPredicateUris(text).length;

  for (const hit of text.matchAll(AGGREGATE_PASS_RE)) {
    if (hit.index === undefined) continue;
    const { scope, enclosed } = scopeFor(text, hit.index);
    let uris = distinctPredicateUris(scope);
    // Fail-closed widening: if the hit is NOT wrapped in any grouping element
    // (no <li>/<tr>/<section> encloses it) and the whole document mixes >= 2
    // predicate URIs, treat the hit as document-scoped. An ungrouped aggregate
    // on a multi-predicate page must not slip through.
    if (!enclosed && docUriCount >= 2) {
      uris = distinctPredicateUris(text);
    }
    if (uris.length >= 2) {
      const start = Math.max(0, hit.index - 60);
      const end = Math.min(text.length, hit.index + hit[0].length + 60);
      violations.push({
        match: hit[0],
        predicateUris: uris,
        index: hit.index,
        excerpt: text.slice(start, end).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return violations;
}

/** A per-file C3 scan result. */
export interface C3FileResult {
  readonly file: string;
  readonly violations: readonly C3Violation[];
}

/** Scan a set of (file, content) pairs; returns only files with violations. */
export function scanFiles(
  files: readonly { readonly file: string; readonly content: string }[],
): C3FileResult[] {
  const results: C3FileResult[] = [];
  for (const { file, content } of files) {
    const violations = scanForAggregatePass(content);
    if (violations.length > 0) {
      results.push({ file, violations });
    }
  }
  return results;
}
