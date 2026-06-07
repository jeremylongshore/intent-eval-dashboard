/**
 * Intentionally-minimal Markdown → HTML renderer for the teaching explainers.
 *
 * This is NOT a general Markdown implementation. It supports exactly the subset
 * the gate explainers (`content/explainers/*.md`) use, so the dashboard needs no
 * Markdown dependency and the rendered output stays auditable single-file HTML —
 * an outsider can `view-source` and see no hidden complexity (the Gregg + CISO
 * "no framework magic" framing the public site already commits to).
 *
 * Supported subset:
 *
 *   Block level:
 *     - `# `, `## `, `### ` ATX headings (levels 1–3)
 *     - blank-line-separated paragraphs
 *     - `- ` unordered list items (consecutive items collapse into one <ul>)
 *
 *   Inline (applied AFTER HTML-escaping, so authored angle brackets are safe):
 *     - `` `code` ``  → <code>
 *     - `**bold**`    → <strong>
 *
 * Everything is HTML-escaped FIRST; the inline tokens are then re-introduced as
 * the ONLY tags. Authors cannot inject raw HTML — by design. Anything outside
 * the subset (tables, links, images, nested lists, ordered lists, blockquotes)
 * is rendered verbatim as escaped text rather than interpreted, so an
 * unsupported construct degrades to plain prose instead of breaking the page.
 */

import { esc } from '../results/render-html.js';

/**
 * NUL-delimited placeholder for a protected code span. NUL (U+0000) cannot occur
 * in authored Markdown, so the placeholder can never collide with real prose
 * (a space-delimited token like ` C0 ` could match text such as "see C0 for…").
 * Built at runtime so no literal control char lives in the source.
 */
const NUL = String.fromCharCode(0);
const codeToken = (n: number): string => `${NUL}C${n}${NUL}`;
const codeTokenRe = new RegExp(`${NUL}C(\\d+)${NUL}`, 'g');

/** Apply the supported INLINE tokens to an already-HTML-escaped string. */
function inline(escaped: string): string {
  // Extract code spans to opaque placeholders FIRST, so the bold pass can never
  // see `**` that lives inside a code span — including `**` adjacent to a
  // backtick boundary (`` `**x**` `` must stay literal, not become a <strong>
  // nested inside the <code>). Code content is then restored verbatim.
  const codeSpans: string[] = [];
  const guarded = escaped.replace(/`([^`]+)`/g, (_m, code: string) => {
    const token = codeToken(codeSpans.length);
    codeSpans.push(`<code>${code}</code>`);
    return token;
  });
  const bolded = guarded.replace(
    /\*\*([^*]+)\*\*/g,
    (_m, bold: string) => `<strong>${bold}</strong>`,
  );
  return bolded.replace(codeTokenRe, (_m, i: string) => codeSpans[Number(i)]!);
}

/** Render the minimal Markdown subset to indented HTML block strings. */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`            <p>${inline(esc(paragraph.join(' ')))}</p>`);
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (listItems.length > 0) {
      const items = listItems
        .map((it) => `                <li>${inline(esc(it))}</li>`)
        .join('\n');
      out.push(`            <ul>\n${items}\n            </ul>`);
      listItems = [];
    }
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === '') {
      flushAll();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushAll();
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? '';
      out.push(`            <h${level}>${inline(esc(text))}</h${level}>`);
      continue;
    }

    const bullet = /^-\s+(.*)$/.exec(line);
    if (bullet !== null) {
      flushParagraph();
      listItems.push(bullet[1] ?? '');
      continue;
    }

    // Plain text line → part of the current paragraph (a pending list ends).
    flushList();
    paragraph.push(line.trim());
  }

  flushAll();
  return out.join('\n');
}
