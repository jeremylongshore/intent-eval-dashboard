/**
 * No-uptime-SLA-claim scanner (puxu.11) — the grep-guard for the CFO binding.
 *
 * ── The hard binding this enforces (DR-035 § 8) ──
 *
 *   NO MISLEADING UPTIME CLAIMS on any public surface.
 *
 * CFO refusal: this is a best-effort, single-operator dashboard. It must NEVER
 * advertise an uptime SLA. The literal "99.9% uptime" and uptime-guarantee
 * language are FORBIDDEN in the public output (`site/`). The public commitment
 * language is exactly: "best-effort, single-operator, see /status for liveness".
 *
 * This is a REAL deterministic detector (mirrors `src/results/c3-scan.ts`), NOT
 * a doc. It is consumed by:
 *   - `scripts/check-uptime-claims.ts` (the CI/`check` gate that exits non-zero),
 *   - the synthetic no-uptime test (current site is clean; a fixture with an
 *     uptime SLA claim fails; the best-effort footer string is NOT flagged).
 *
 * Detection model
 * ───────────────
 * It flags uptime-SLA-style claims, NOT the bare word "uptime" in neutral prose.
 * A claim is any of:
 *   1. a numeric availability percent near "uptime" — e.g. `99.9% uptime`,
 *      `99.99 % uptime`, `uptime: 99.9%`, `uptime of 99.95%` (any order, any
 *      "nines"-style figure);
 *   2. an explicit uptime promise — `uptime guarantee`, `guaranteed uptime`,
 *      `uptime SLA`, `SLA: 99.9%`, `availability guarantee`,
 *      `X% availability`, `X nines` (e.g. "four nines").
 *
 * The exact best-effort commitment string contains neither a percent-near-uptime
 * nor a promise phrase, so it is structurally safe. The neutral words "liveness"
 * and "status" are never matched.
 *
 * Self-contained (zero imports) so it strips cleanly under
 * `--experimental-strip-types` with no build — same as the C3 scanner.
 */

/** A single uptime-SLA-claim hit found in some text. */
export interface UptimeClaim {
  /** Which rule fired (for the error message). */
  readonly rule: string;
  /** The offending snippet. */
  readonly match: string;
  /** Character offset of the match in the scanned text. */
  readonly index: number;
  /** Short context excerpt around the match. */
  readonly excerpt: string;
}

/**
 * The forbidden patterns. Each is an uptime-SLA *claim*, never the bare word.
 *
 * Order matters only for which rule label is reported on overlap; all are
 * scanned. `\b` word boundaries + bounded `[\s\S]{0,N}` gaps keep each pattern
 * tight so neutral prose ("see /status for liveness") cannot match.
 */
const RULES: readonly { readonly name: string; readonly re: RegExp }[] = [
  // A nines-style percent within a short distance of "uptime", either order.
  {
    name: 'percent-near-uptime',
    re: /\b\d{1,3}(?:\.\d+)?\s*%[\s\S]{0,20}\buptime\b|\buptime\b[\s\S]{0,20}\d{1,3}(?:\.\d+)?\s*%/gi,
  },
  // Explicit uptime promise phrasing.
  {
    name: 'uptime-promise',
    re: /\buptime\s+guarantee\b|\bguarantee(?:d|s)?\s+uptime\b|\buptime\s+sla\b/gi,
  },
  // SLA percent or availability-percent guarantee.
  {
    name: 'availability-sla',
    re: /\bsla\b\s*:?\s*\d{1,3}(?:\.\d+)?\s*%|\b\d{1,3}(?:\.\d+)?\s*%\s+availability\b|\bavailability\s+guarantee\b|\bguaranteed\s+availability\b/gi,
  },
  // "X nines" availability shorthand (two/three/four/five nines, or "9 nines").
  {
    name: 'nines-shorthand',
    re: /\b(?:two|three|four|five|\d+)\s+nines\b/gi,
  },
];

/**
 * Scan one text blob for uptime-SLA claims. Returns every hit found. An empty
 * array means the text carries no forbidden uptime-SLA claim.
 */
export function scanForUptimeClaims(text: string): UptimeClaim[] {
  const claims: UptimeClaim[] = [];
  for (const { name, re } of RULES) {
    // Fresh lastIndex per call (RULES regexes are module-level + /g).
    re.lastIndex = 0;
    for (const hit of text.matchAll(re)) {
      if (hit.index === undefined) continue;
      const start = Math.max(0, hit.index - 50);
      const end = Math.min(text.length, hit.index + hit[0].length + 50);
      claims.push({
        rule: name,
        match: hit[0],
        index: hit.index,
        excerpt: text.slice(start, end).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  // Stable order: by position in the document.
  claims.sort((a, b) => a.index - b.index);
  return claims;
}

/** A per-file uptime-claim scan result. */
export interface UptimeFileResult {
  readonly file: string;
  readonly claims: readonly UptimeClaim[];
}

/** Scan a set of (file, content) pairs; returns only files with claims. */
export function scanFilesForUptimeClaims(
  files: readonly { readonly file: string; readonly content: string }[],
): UptimeFileResult[] {
  const results: UptimeFileResult[] = [];
  for (const { file, content } of files) {
    const claims = scanForUptimeClaims(content);
    if (claims.length > 0) {
      results.push({ file, claims });
    }
  }
  return results;
}
