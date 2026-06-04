/**
 * Tombstone page generator (bead puxu.10).
 *
 * For each retraction, a public disclosure page served at the retracted deep
 * URL (Caddy rewrites to it + returns 410). The page states plainly:
 *
 *   "This attestation exists in the transparency log and we have chosen not to
 *    surface it because <reason_class>."
 *
 * Append-only honesty: Sigstore / Rekor entries CANNOT be un-logged. We do not
 * pretend the attestation never existed — we DISCLOSE the retraction and its
 * reason. The original row remains in the transparency log; this page is the
 * human-readable face of the signed `retraction/v1` Statement.
 *
 * The page reuses the public site's HTML chrome (shared `/style.css`, header,
 * footer, `esc`) so it matches the single-file static pattern AND passes the
 * deploy HTML sanity gate (DOCTYPE + closing tag + stylesheet link). It carries
 * `noindex` so search engines drop the retracted URL (reinforcing the 410). The
 * page is structurally C3-clean: it renders no predicate-URI decision counts at
 * all, so it can never carry a cross-predicate aggregate PASS%.
 */

import { esc, SITE_FOOTER, SITE_HEADER } from '../results/render-html.js';
import { type RetractionEntry, type RetractionReasonClass } from './denylist.js';
import { RETRACTION_V1_URI } from './statement.js';

/**
 * Human-readable, single-sentence explanation per closed-set reason class. The
 * KEYS are the closed set — a `Record<RetractionReasonClass, …>` so adding a
 * kernel reason class without wording here is a COMPILE error (the type is
 * sourced from the kernel via the denylist).
 */
const REASON_WORDING: Record<RetractionReasonClass, string> = {
  'partner-request': 'a partner asked us to stop surfacing this result',
  'methodology-error': 'we found the evaluation methodology behind this result to be flawed',
  'data-quality': 'the underlying data for this result was bad or corrupted',
  'consent-withdrawn': 'consent to publish this result was withdrawn',
  'legal-hold': 'a legal hold requires that this result not be surfaced',
  'pre-publication-recall': 'this result was recalled before it was ever published publicly',
};

/**
 * The disclosure sentence for a reason class. `REASON_WORDING` is keyed by the
 * full closed set, so a lookup is always defined; the `?? throw` guards the
 * `noUncheckedIndexedAccess` `| undefined` for an impossible out-of-set value
 * (the denylist validator already rejects those before we ever reach here).
 */
export function reasonSentence(reasonClass: RetractionReasonClass): string {
  const sentence = REASON_WORDING[reasonClass];
  if (sentence === undefined) {
    throw new Error(`no tombstone wording for reason_class "${String(reasonClass)}"`);
  }
  return sentence;
}

const PAGE_HEAD = (title: string, description: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="noindex, follow">
    <link rel="stylesheet" href="/style.css">

    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
    <meta name="iep-surface" content="retraction-tombstone">
</head>`;

/**
 * Render the tombstone HTML for one retraction entry.
 *
 * The body discloses: that the attestation EXISTS in the transparency log, that
 * we have chosen not to surface it, the reason_class (machine signal) + its
 * plain-English sentence, when it was retracted, and the optional operator note.
 */
export function renderTombstone(entry: RetractionEntry): string {
  const title = 'Retracted — Intent Eval Platform';
  const description = `This attestation was retracted (${entry.reason_class}). It remains in the transparency log; we have chosen not to surface it.`;

  const subjectRefs: string[] = [];
  if (entry.bundle_id !== undefined)
    subjectRefs.push(`<dt>bundle id</dt><dd><code>${esc(entry.bundle_id)}</code></dd>`);
  if (entry.storage_key !== undefined)
    subjectRefs.push(`<dt>storage key</dt><dd><code>${esc(entry.storage_key)}</code></dd>`);
  if (entry.content_hash !== undefined)
    subjectRefs.push(`<dt>content hash</dt><dd><code>${esc(entry.content_hash)}</code></dd>`);

  const note =
    entry.note !== undefined
      ? `        <div class="meta-block">
            <p style="margin:0;"><strong>Operator note:</strong> ${esc(entry.note)}</p>
        </div>`
      : '';

  const retractedBy =
    entry.retracted_by !== undefined
      ? `<dt>retracted by</dt><dd><code>${esc(entry.retracted_by)}</code></dd>`
      : '';

  return `${PAGE_HEAD(title, description)}
<body>
${SITE_HEADER}
    <main>
        <h1>This result has been retracted</h1>
        <div class="no-data-panel">
            <p class="no-data-panel__title"><span class="badge badge--no-data">retracted</span> ${esc(entry.deep_url_path)}</p>
            <p>
                This attestation <strong>exists in the transparency log</strong> and we have
                <strong>chosen not to surface it</strong> because
                <strong>${esc(reasonSentence(entry.reason_class))}</strong>
                (<code>${esc(entry.reason_class)}</code>).
            </p>
            <p>
                A retraction does <strong>not</strong> delete the original attestation. Sigstore
                and the Rekor transparency log are append-only — they cannot be un-logged. Rather
                than pretend this result never existed, we disclose the retraction and its reason.
                This page is the human-readable face of a signed
                <code>${esc(RETRACTION_V1_URI)}</code> record.
            </p>
        </div>
        <div class="meta-block">
            <dl>
                <dt>reason class</dt><dd><code>${esc(entry.reason_class)}</code></dd>
                <dt>retracted at</dt><dd><time datetime="${esc(entry.retracted_at)}">${esc(entry.retracted_at)}</time></dd>
                ${retractedBy}
                ${subjectRefs.join('\n                ')}
            </dl>
        </div>
${note}
        <p><a href="/results/">← Back to results</a></p>
    </main>
${SITE_FOOTER}`;
}
