/**
 * HTML rendering for the public per-skill adoption + human-trust surface
 * (`/skills/`), the wave-2 sibling of `src/results/render-html.ts`.
 *
 * Hard bindings enforced HERE (in addition to the C3 lint that scans output):
 *
 *   - **No rolled / aggregate score across dimensions or predicates.** The three
 *     dimension panels are rendered by THREE separate functions, each of which
 *     takes EXACTLY ONE dimension. There is deliberately no `renderRolledScore`,
 *     no function that takes two dimensions, and no code path that composites a
 *     skill-level "score" or "pass %". (DR-035 C3 + DR-103 C3 — CTO + CMO + VP
 *     DevRel triple-refusal.)
 *   - **No renderer arithmetic** (DR-103 Item 6 HARDEN Rule 1). The panels print
 *     RAW verified counts the kernel entities already carry. They never divide,
 *     ratio, or percentage anything. A rate must be a field the kernel emits
 *     inside the verified bundle, not synthesised here.
 *   - **`no-data` carries fail-equal visual weight.** A skill / dimension with no
 *     verified signal renders the loud `no-data` panel (reusing the shared
 *     `badge--no-data` == `badge--fail` weight), never a neutral blank. (DR-035
 *     C4 — absence is loud, never back-filled.)
 *   - **No predicate URI declared at labs.*** — predicate URIs are only ever
 *     RENDERED (as the surface a dimension attests against, pointed at evals.*).
 *     (CISO, DR-035 § 8.)
 *
 * Chrome (head / header / footer / escaping / slug / no-data panel) is REUSED
 * from `render-html.ts` so this surface is a faithful sibling of the results
 * browser, not a divergent fork.
 */

import { esc, noDataPanel, SITE_FOOTER, SITE_HEADER, slug } from '../results/render-html.js';
import {
  type AdoptionSignal,
  type HumanTrustSignal,
  type QualitySignal,
  type SkillCard,
  type SkillsView,
} from './skill-signal-model.js';

/** Stable per-skill URL. */
export function skillUrl(skill: string): string {
  return `/skills/${slug(skill)}/`;
}

const PAGE_HEAD = (
  title: string,
  description: string,
  canonical: string,
): string => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://labs.intentsolutions.io${esc(canonical)}">
    <link rel="stylesheet" href="/style.css">

    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="https://labs.intentsolutions.io${esc(canonical)}">
    <meta property="og:type" content="website">

    <meta name="iep-source-repo" content="github.com/jeremylongshore/intent-eval-dashboard">
    <meta name="iep-dashboard-version" content="0.1.0">
</head>`;

/** A small provenance line under a dimension panel (predicate URI + ingest ts). */
function provenanceLine(predicateUri: string, ingestedAt: string): string {
  const ingest =
    ingestedAt.length > 0
      ? `<time datetime="${esc(ingestedAt)}">${esc(ingestedAt)}</time>`
      : '<code>—</code>';
  return `            <p class="dimension-provenance">attests against <code>${esc(predicateUri)}</code> · ingested ${ingest}</p>`;
}

/**
 * Render the ADOPTION panel for ONE skill.
 *
 * Takes ONLY the adoption dimension. Prints raw verified per-`(meter, unit)`
 * counts — never a cross-pair sum, never a rate. no-data is loud.
 */
export function renderAdoptionPanel(skill: string, adoption: AdoptionSignal): string {
  if (adoption.noData) {
    return `        <section class="dimension dimension--adoption">
            <h3>Adoption</h3>
${indent(noDataPanel(`${skill} · adoption`))}
        </section>`;
  }
  const rows = adoption.perMeter
    .map(
      (m) => `                <tr>
                    <td><code>${esc(m.meter)}</code></td>
                    <td><code>${esc(m.unit)}</code></td>
                    <td>${m.count}</td>
                    <td>${m.eventCount}</td>
                </tr>`,
    )
    .join('\n');
  return `        <section class="dimension dimension--adoption">
            <h3>Adoption</h3>
            <p class="dimension-note">Verified usage counts from signed <code>UsageEvent</code> rows, shown <em>per <code>(meter, unit)</code></em> only. We never sum across heterogeneous meters or units — that would be metric laundering. These are raw counts, not rates.</p>
            <table class="dimension-table">
                <thead>
                    <tr><th>Meter</th><th>Unit</th><th>Verified count</th><th>Events</th></tr>
                </thead>
                <tbody>
${rows}
                </tbody>
            </table>
${provenanceLine(adoption.provenance.predicateUri, adoption.provenance.ingestedAt)}
        </section>`;
}

/**
 * Render the HUMAN-TRUST panel for ONE skill.
 *
 * Takes ONLY the human-trust dimension. The three kernel channels stay separate:
 * thumbs up/down as distinct raw tallies (never a net or ratio), score_text +
 * annotation listed verbatim (NON-COMPARABLE free text, never parsed). no-data
 * is loud.
 */
export function renderHumanTrustPanel(skill: string, trust: HumanTrustSignal): string {
  if (trust.noData) {
    return `        <section class="dimension dimension--human-trust">
            <h3>Human trust</h3>
${indent(noDataPanel(`${skill} · human-trust`))}
        </section>`;
  }
  const scoreTexts =
    trust.scoreTexts.length > 0
      ? `            <p class="dimension-subhead">Free-text assessments (non-comparable — never scored or averaged):</p>
            <ul class="dimension-list">
${trust.scoreTexts.map((t) => `                <li>${esc(t)}</li>`).join('\n')}
            </ul>`
      : '';
  const annotations =
    trust.annotations.length > 0
      ? `            <p class="dimension-subhead">Annotations:</p>
            <ul class="dimension-list">
${trust.annotations.map((t) => `                <li>${esc(t)}</li>`).join('\n')}
            </ul>`
      : '';
  return `        <section class="dimension dimension--human-trust">
            <h3>Human trust</h3>
            <p class="dimension-note">Verified <code>HumanReview</code> signals. The thumbs, free-text, and annotation channels stay orthogonal — we never fold them into a single trust score. Counts are raw, not ratios.</p>
            <table class="dimension-table">
                <thead>
                    <tr><th>Signal</th><th>Verified count</th></tr>
                </thead>
                <tbody>
                    <tr><td>👍 thumbs up</td><td>${trust.thumbsUp}</td></tr>
                    <tr><td>👎 thumbs down</td><td>${trust.thumbsDown}</td></tr>
                    <tr><td>total reviews</td><td>${trust.reviewCount}</td></tr>
                </tbody>
            </table>
${scoreTexts}
${annotations}
${provenanceLine(trust.provenance.predicateUri, trust.provenance.ingestedAt)}
        </section>`;
}

/**
 * Render the QUALITY panel for ONE skill.
 *
 * Takes ONLY the quality dimension. Per DR-103 Item 6 the rubric grade is
 * delegated BACK to validate-skillmd unchanged — this panel only LINKS to it; it
 * never inlines a quality scalar that could be combined with the other
 * dimensions. no-data (no rubric ref) is loud.
 */
export function renderQualityPanel(skill: string, quality: QualitySignal): string {
  if (quality.noData || quality.rubricRef === null) {
    return `        <section class="dimension dimension--quality">
            <h3>Quality (authoring rubric)</h3>
${indent(noDataPanel(`${skill} · quality-rubric`))}
        </section>`;
  }
  return `        <section class="dimension dimension--quality">
            <h3>Quality (authoring rubric)</h3>
            <p class="dimension-note">The authoring-quality grade is owned by <code>validate-skillmd</code> and rendered there unchanged — we link to it rather than re-score or combine it with adoption / human-trust.</p>
            <p><a href="${esc(quality.rubricRef)}">View the validate-skillmd rubric grade for <code>${esc(skill)}</code> →</a></p>
${provenanceLine(quality.provenance.predicateUri, quality.provenance.ingestedAt)}
        </section>`;
}

/**
 * Render ONE skill's full card = the three independent panels, side by side.
 *
 * NOTE: this function composes three SEPARATE single-dimension renderers; it
 * never computes anything across them. There is no aggregate header, no
 * skill-level score — by construction.
 */
export function renderSkillCard(card: SkillCard): string {
  return `    <article class="skill-card" id="${esc(slug(card.skill))}">
        <h2><a href="${esc(skillUrl(card.skill))}"><code>${esc(card.skill)}</code></a></h2>
        <p class="skill-card__note">Each dimension below is independent. We do not publish a single rolled "skill score" — adoption, human-trust, and authoring-quality are different measurements against different predicates and are never combined.</p>
${renderAdoptionPanel(card.skill, card.adoption)}
${renderHumanTrustPanel(card.skill, card.humanTrust)}
${renderQualityPanel(card.skill, card.quality)}
    </article>`;
}

/** The global "as-of" banner (min ingestedAt across dimensions with a signal). */
export function skillsAsOfBanner(view: SkillsView): string {
  if (view.asOf === undefined) {
    return `        <div class="meta-block as-of as-of--none">
            <p style="margin:0;"><strong>As of:</strong> no skill has a verified adoption, human-trust, or quality signal yet. Every dimension below is in a <code>no-data</code> state.</p>
        </div>`;
  }
  return `        <div class="meta-block as-of">
            <p style="margin:0;"><strong>As of:</strong> <time datetime="${esc(view.asOf)}">${esc(view.asOf)}</time> — the oldest ingest across every dimension with a verified signal (<code>min(ingested_at)</code>).</p>
        </div>`;
}

/** Render the `/skills/` index page (all skill cards). */
export function renderSkillsIndex(view: SkillsView): string {
  const title = 'Per-skill signals — Intent Eval Platform';
  const description =
    'Per-skill adoption + human-trust + authoring-quality signals from the Intent Eval Platform, rendered per dimension. No rolled aggregate score across dimensions or predicates.';
  const cards = view.skills.map(renderSkillCard).join('\n');
  return `${PAGE_HEAD(title, description, '/skills/')}
<body>
${SITE_HEADER}
    <main>
        <h1>Per-skill signals</h1>
        <p class="lead">
            Adoption (signed <code>UsageEvent</code> counts), human-trust (signed <code>HumanReview</code> signals), and authoring-quality (the <code>validate-skillmd</code> rubric) — rendered <em>per skill, per dimension</em>. The adoption-score values are produced upstream by j-rig; this dashboard is a pure consumer that renders the verified kernel entities.
        </p>
        <p>
            We deliberately do NOT publish a single rolled "skill score." Each dimension is a different measurement against a different predicate URI; compositing them into one number would be metric laundering. <code>no-data</code> is shown loudly, never blanked or back-filled.
        </p>
${skillsAsOfBanner(view)}
${cards}
    </main>
${SITE_FOOTER}`;
}

/** Render one skill's `/skills/<skill>/` page. */
export function renderSkillPage(card: SkillCard): string {
  const title = `Signals: ${card.skill} — Intent Eval Platform`;
  const description = `Per-dimension adoption + human-trust + authoring-quality signals for ${card.skill}.`;
  return `${PAGE_HEAD(title, description, skillUrl(card.skill))}
<body>
${SITE_HEADER}
    <main>
        <p><a href="/skills/">← All skills</a></p>
${renderSkillCard(card)}
    </main>
${SITE_FOOTER}`;
}

/** Indent a multi-line block by 4 extra spaces (for nesting a shared panel). */
function indent(block: string): string {
  return block
    .split('\n')
    .map((line) => (line.length > 0 ? `    ${line}` : line))
    .join('\n');
}
