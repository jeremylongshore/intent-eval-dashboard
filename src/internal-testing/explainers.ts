/**
 * Authored explainer loader — the teaching prose half of the dashboard
 * (Pillar 1, bead nr75.2).
 *
 * Each gate type has a one-time authored explainer in `content/explainers/<key>.md`
 * answering: *what is this, how do we run it, what does good look like.* The
 * loader reads those files into {@link ExplainerDoc}s; the render lane joins each
 * verified gate-result row with the matching explainer so the page reads like a
 * guided tour rather than a CSV.
 *
 * Matching is by gate name, with a small alias table for the common gate-name
 * variants the audit-harness emits (e.g. `crap-score` → the `crap` explainer),
 * falling back to the generic `gate-result` explainer when a specific one is not
 * authored. A missing explainer never blocks render — the row still shows its
 * data + verdict + fixes, just without the prose.
 *
 * The loader is the ONLY filesystem touch in this lane; everything downstream
 * takes an in-memory {@link ExplainerSet}, so render + verdict + generate stay
 * pure and unit-testable without disk.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderMarkdown } from './markdown.js';

/** One authored explainer, already converted to safe HTML. */
export interface ExplainerDoc {
  /** Explainer key (the filename without `.md`). */
  readonly key: string;
  /** Display title (first `# ` heading, or the key if none). */
  readonly title: string;
  /** Rendered HTML body (everything after the title line). */
  readonly html: string;
}

/** A loaded set of explainers, keyed by explainer key. */
export type ExplainerSet = ReadonlyMap<string, ExplainerDoc>;

/** The generic fallback explainer key (every gate-result row can use it). */
export const GENERIC_EXPLAINER_KEY = 'gate-result';

/** The "how to read this dashboard" landing explainer key. */
export const INDEX_EXPLAINER_KEY = '_index';

/**
 * Common gate-name → explainer-key aliases. The audit-harness emits gate names
 * that do not always equal the explainer filename; this maps the known variants
 * onto the authored explainer so the prose still attaches.
 */
const GATE_NAME_ALIASES: Readonly<Record<string, string>> = {
  'crap-score': 'crap',
  crap: 'crap',
  'arch-check': 'architecture',
  'architecture-check': 'architecture',
  architecture: 'architecture',
  'mutation-test': 'mutation',
  'mutation-score': 'mutation',
  mutation: 'mutation',
  'coverage-check': 'coverage',
  coverage: 'coverage',
  'escape-scan': 'escape-scan',
};

/** Split a raw markdown doc into its title (first `# `) + the remaining body. */
function splitTitle(md: string): { title: string; body: string } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const idx = lines.findIndex((l) => /^#\s+/.test(l));
  if (idx === -1) {
    return { title: '', body: md };
  }
  const title = lines[idx]?.replace(/^#\s+/, '').trim() ?? '';
  const body = lines.slice(idx + 1).join('\n');
  return { title, body };
}

/**
 * Load every `*.md` explainer in `dir` into an {@link ExplainerSet}.
 *
 * Non-`.md` entries are ignored. A directory that does not exist or is empty
 * yields an empty set (render then degrades to data-only, never crashes).
 */
export async function loadExplainers(dir: string): Promise<ExplainerSet> {
  const map = new Map<string, ExplainerDoc>();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return map; // no explainer dir → empty set (data-only render)
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const key = entry.slice(0, -'.md'.length);
    const raw = await readFile(join(dir, entry), 'utf8');
    const { title, body } = splitTitle(raw);
    map.set(key, {
      key,
      title: title.length > 0 ? title : key,
      html: renderMarkdown(body),
    });
  }
  return map;
}

/**
 * Resolve the explainer for a gate name: exact key → alias → generic fallback.
 * Returns `undefined` only when not even the generic explainer is loaded.
 */
export function explainerFor(set: ExplainerSet, gateName: string): ExplainerDoc | undefined {
  const direct = set.get(gateName);
  if (direct !== undefined) return direct;

  const aliased = GATE_NAME_ALIASES[gateName];
  if (aliased !== undefined) {
    const doc = set.get(aliased);
    if (doc !== undefined) return doc;
  }

  return set.get(GENERIC_EXPLAINER_KEY);
}
