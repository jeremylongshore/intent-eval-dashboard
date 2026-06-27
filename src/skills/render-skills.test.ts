/**
 * Per-skill render — output integrity tests.
 *
 * The load-bearing assertions:
 *   - the rendered HTML is C3-CLEAN per the REAL `scanForAggregatePass` scanner
 *     (no cross-predicate aggregate PASS%), even on a fully-populated multi-skill
 *     page that mixes predicate URIs;
 *   - no-data renders the loud `badge--no-data` panel (fail-equal weight);
 *   - no predicate URI is DECLARED at labs.* (only rendered, pointed at evals.*);
 *   - the page is a complete self-contained HTML doc (DOCTYPE + </html>);
 *   - each panel renderer takes ONE dimension — there is no cross-dimension
 *     rollup string in the output.
 */

import { describe, expect, it } from 'vitest';
import { scanForAggregatePass } from '../results/c3-scan.js';
import {
  renderAdoptionPanel,
  renderHumanTrustPanel,
  renderQualityPanel,
  renderSkillsIndex,
  renderSkillPage,
} from './render-skills.js';
import { buildSkillCard, buildSkillsView } from './skill-signal-model.js';
import {
  FixtureSkillResolver,
  makeHumanReview,
  makeSignals,
  makeUsageEvent,
} from './__fixtures__/skills-fixtures.js';

function populatedCard(skill: string) {
  return buildSkillCard(
    skill,
    makeSignals({
      usageEvents: [
        makeUsageEvent({ meter: 'skill_invocation', unit: 'count', quantity: 9 }),
        makeUsageEvent({ meter: 'eval_run', unit: 'count', quantity: 2 }),
      ],
      humanReviews: [
        makeHumanReview({ thumbs: true, score_text: '4/5 strong on refusals', annotation: null }),
        makeHumanReview({ thumbs: false, score_text: null, annotation: 'over-long preamble' }),
      ],
      rubricRef: 'https://example.test/validate-skillmd/my-skill',
    }),
  );
}

describe('render-skills — C3 cleanliness (real scanner)', () => {
  it('a populated multi-skill index is C3-clean (no cross-predicate aggregate PASS%)', async () => {
    const map = new Map([
      [
        'alpha',
        makeSignals({
          usageEvents: [makeUsageEvent({ quantity: 5 })],
          humanReviews: [makeHumanReview({ thumbs: true })],
          rubricRef: 'https://example.test/r/a',
        }),
      ],
      [
        'beta',
        makeSignals({
          usageEvents: [makeUsageEvent({ quantity: 3 })],
          humanReviews: [makeHumanReview({ thumbs: false })],
          rubricRef: 'https://example.test/r/b',
        }),
      ],
    ]);
    const view = await buildSkillsView(['alpha', 'beta'], new FixtureSkillResolver(map));
    const html = renderSkillsIndex(view);
    // The page DOES mix predicate URIs (human-review/v1 + gate-result/v1 +
    // validation-result/v1) — exactly the condition the C3 scanner guards. It
    // must still be clean because no PASS% aggregate is ever emitted.
    expect(scanForAggregatePass(html)).toEqual([]);
  });

  it('a per-skill page with free-text containing a fraction stays C3-clean', () => {
    // score_text "4/5 strong" contains a fraction but NOT the "pass" token, so it
    // is not an aggregate-PASS metric. Proves verbatim free-text is safe.
    const html = renderSkillPage(populatedCard('my-skill'));
    expect(scanForAggregatePass(html)).toEqual([]);
  });
});

describe('render-skills — loud no-data', () => {
  it('renders the loud no-data badge for an empty adoption dimension', () => {
    const card = buildSkillCard('empty-skill', makeSignals({}));
    const panel = renderAdoptionPanel(card.skill, card.adoption);
    expect(panel).toContain('badge--no-data');
    expect(panel).toContain('No data is not a pass');
  });

  it('renders loud no-data for empty human-trust + quality dimensions', () => {
    const card = buildSkillCard('empty-skill', makeSignals({}));
    expect(renderHumanTrustPanel(card.skill, card.humanTrust)).toContain('badge--no-data');
    expect(renderQualityPanel(card.skill, card.quality)).toContain('badge--no-data');
  });
});

describe('render-skills — chrome + bindings', () => {
  it('emits a complete self-contained HTML document', () => {
    const html = renderSkillPage(populatedCard('my-skill'));
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<link rel="stylesheet" href="/style.css">');
  });

  it('declares its canonical at labs.* but only RENDERS predicate URIs at evals.*', () => {
    const html = renderSkillPage(populatedCard('my-skill'));
    // canonical/og url are labs.* (the page's own identity) ...
    expect(html).toContain('https://labs.intentsolutions.io/skills/my-skill/');
    // ... but every predicate URI in the body points at evals.*, never labs.*.
    // Capture the FULL https://<sub>.intentsolutions.io/<name>/vN and parse the
    // host via URL (not a substring/startsWith check, which CodeQL rightly flags
    // as bypassable host validation) — assert the subdomain is exactly "evals".
    const predicateHits =
      html.match(/https:\/\/[a-z]+\.intentsolutions\.io\/[a-z-]+\/v[0-9]+/gi) ?? [];
    expect(predicateHits.length).toBeGreaterThan(0);
    // Parse each hit's host via URL (not a substring/regex check, which CodeQL
    // rightly flags as bypassable host validation): the predicate-URI subdomain
    // is ALWAYS evals.* and NEVER labs.*.
    const hosts = predicateHits.map((hit) => new URL(hit).host);
    for (const host of hosts) {
      expect(host).toBe('evals.intentsolutions.io');
    }
    expect(hosts).not.toContain('labs.intentsolutions.io');
  });

  it('renders an em-dash for a populated dimension whose ingest timestamp is empty', () => {
    // A verified signal with a blank ingest ts (edge: resolver supplied null) —
    // the provenance line must show a loud em-dash, never fabricate a time.
    const card = buildSkillCard(
      's',
      makeSignals({
        usageEvents: [makeUsageEvent({ quantity: 1 })],
        usageIngestedAt: null,
      }),
    );
    const panel = renderAdoptionPanel(card.skill, card.adoption);
    expect(panel).toContain('ingested <code>—</code>');
  });

  it('renders adoption counts verbatim — no renderer arithmetic (no % sign on counts)', () => {
    const panel = renderAdoptionPanel(
      's',
      buildSkillCard('s', makeSignals({ usageEvents: [makeUsageEvent({ quantity: 42 })] }))
        .adoption,
    );
    expect(panel).toContain('>42<');
    // The adoption panel never renders a percentage (a renderer-side ratio is forbidden).
    expect(panel).not.toMatch(/[0-9]+\s*%/);
  });
});
