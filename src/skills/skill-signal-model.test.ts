/**
 * Per-skill signal view-model — unit + C3-structural tests.
 *
 * Proves:
 *   - adoption counts are summed STRICTLY within a (meter, unit) pair, never
 *     across heterogeneous pairs (C3);
 *   - human-trust channels stay orthogonal (thumbs up/down kept separate;
 *     score_text/annotation verbatim);
 *   - quality is link-out only (no scalar stored);
 *   - no-data is loud (never a synthetic pass);
 *   - the SkillCard shape has NO aggregate field (the structural C3 defence).
 */

import { describe, expect, it } from 'vitest';
import {
  buildAdoptionSignal,
  buildHumanTrustSignal,
  buildQualitySignal,
  buildSkillCard,
  buildSkillsView,
  HUMAN_REVIEW_PREDICATE_URI,
  USAGE_PREDICATE_URI,
} from './skill-signal-model.js';
import {
  FixtureSkillResolver,
  makeHumanReview,
  makeSignals,
  makeUsageEvent,
} from './__fixtures__/skills-fixtures.js';

describe('buildAdoptionSignal', () => {
  it('is loud no-data on zero events', () => {
    const a = buildAdoptionSignal([], USAGE_PREDICATE_URI, null);
    expect(a.noData).toBe(true);
    expect(a.perMeter).toEqual([]);
  });

  it('sums quantity WITHIN one (meter, unit) pair', () => {
    const a = buildAdoptionSignal(
      [
        makeUsageEvent({ meter: 'skill_invocation', unit: 'count', quantity: 3 }),
        makeUsageEvent({ meter: 'skill_invocation', unit: 'count', quantity: 4 }),
      ],
      USAGE_PREDICATE_URI,
      '2026-06-25T12:00:05.000Z',
    );
    expect(a.noData).toBe(false);
    expect(a.perMeter).toHaveLength(1);
    expect(a.perMeter[0]?.count).toBe(7);
    expect(a.perMeter[0]?.eventCount).toBe(2);
  });

  it('keeps heterogeneous (meter, unit) pairs as DISTINCT rows — never cross-summed', () => {
    const a = buildAdoptionSignal(
      [
        makeUsageEvent({ meter: 'skill_invocation', unit: 'count', quantity: 5 }),
        makeUsageEvent({ meter: 'eval_run', unit: 'count', quantity: 2 }),
        makeUsageEvent({ meter: 'api_call', unit: 'tokens', quantity: 1000 }),
      ],
      USAGE_PREDICATE_URI,
      '2026-06-25T12:00:05.000Z',
    );
    // Three distinct pairs, each kept separate. No single combined scalar exists.
    expect(a.perMeter).toHaveLength(3);
    const counts = a.perMeter.map((m) => m.count).sort((x, y) => x - y);
    expect(counts).toEqual([2, 5, 1000]);
    // There is no field on AdoptionSignal that totals these — assert by shape.
    expect(Object.keys(a)).toEqual(['provenance', 'perMeter', 'noData']);
    expect(a).not.toHaveProperty('total');
    expect(a).not.toHaveProperty('score');
  });
});

describe('buildHumanTrustSignal', () => {
  it('is loud no-data on zero reviews', () => {
    const t = buildHumanTrustSignal([], HUMAN_REVIEW_PREDICATE_URI, null);
    expect(t.noData).toBe(true);
    expect(t.reviewCount).toBe(0);
  });

  it('keeps thumbs up/down as SEPARATE raw tallies (never a net or ratio)', () => {
    const t = buildHumanTrustSignal(
      [
        makeHumanReview({ thumbs: true }),
        makeHumanReview({ thumbs: true }),
        makeHumanReview({ thumbs: false }),
      ],
      HUMAN_REVIEW_PREDICATE_URI,
      '2026-06-25T12:00:06.000Z',
    );
    expect(t.thumbsUp).toBe(2);
    expect(t.thumbsDown).toBe(1);
    expect(t.reviewCount).toBe(3);
    // No net/ratio field exists.
    expect(t).not.toHaveProperty('netThumbs');
    expect(t).not.toHaveProperty('trustScore');
  });

  it('lists score_text + annotation verbatim (non-comparable, never parsed)', () => {
    const t = buildHumanTrustSignal(
      [
        makeHumanReview({ thumbs: null, score_text: '4/5 — strong', annotation: null }),
        makeHumanReview({ thumbs: null, score_text: null, annotation: 'check the refusal path' }),
      ],
      HUMAN_REVIEW_PREDICATE_URI,
      '2026-06-25T12:00:06.000Z',
    );
    expect(t.scoreTexts).toEqual(['4/5 — strong']);
    expect(t.annotations).toEqual(['check the refusal path']);
  });
});

describe('buildQualitySignal', () => {
  it('is loud no-data when no rubric ref', () => {
    const q = buildQualitySignal(
      null,
      'https://evals.intentsolutions.io/validation-result/v1',
      null,
    );
    expect(q.noData).toBe(true);
    expect(q.rubricRef).toBeNull();
  });

  it('is link-out only — stores no quality scalar', () => {
    const q = buildQualitySignal(
      'https://example.test/rubric',
      'https://evals.intentsolutions.io/validation-result/v1',
      '2026-06-25T12:00:07.000Z',
    );
    expect(q.noData).toBe(false);
    expect(q.rubricRef).toBe('https://example.test/rubric');
    expect(q).not.toHaveProperty('score');
    expect(q).not.toHaveProperty('grade');
  });
});

describe('buildSkillCard — C3 structural defence', () => {
  it('has EXACTLY the three dimension fields + skill — NO aggregate field', () => {
    const card = buildSkillCard(
      'my-skill',
      makeSignals({
        usageEvents: [makeUsageEvent({ quantity: 2 })],
        humanReviews: [makeHumanReview({ thumbs: true })],
        rubricRef: 'https://example.test/rubric',
      }),
    );
    // The keys ARE the C3 contract: skill + 3 independent dimensions, nothing else.
    expect(Object.keys(card).sort()).toEqual(['adoption', 'humanTrust', 'quality', 'skill']);
    // Belt-and-suspenders: no rolled-score-shaped field anywhere on the card.
    for (const banned of ['rolledScore', 'overallScore', 'score', 'passPct', 'aggregate']) {
      expect(card as unknown as Record<string, unknown>).not.toHaveProperty(banned);
    }
  });

  it('there is no exported reducer that combines two dimensions', async () => {
    // Importing the module surface and asserting no cross-dimension combinator
    // exists keeps the "no rolled score" binding testable, not just prose.
    const mod = (await import('./skill-signal-model.js')) as Record<string, unknown>;
    for (const name of Object.keys(mod)) {
      expect(name.toLowerCase()).not.toMatch(/roll|aggregate|overall|composite/);
    }
  });
});

describe('buildSkillsView', () => {
  it('renders a fully-no-data card for an unknown skill (resolver null)', async () => {
    const view = await buildSkillsView(['ghost'], new FixtureSkillResolver(new Map()));
    expect(view.skills).toHaveLength(1);
    const card = view.skills[0]!;
    expect(card.adoption.noData).toBe(true);
    expect(card.humanTrust.noData).toBe(true);
    expect(card.quality.noData).toBe(true);
    // No verified signal anywhere => no as-of (honest current state).
    expect(view.asOf).toBeUndefined();
  });

  it('computes as-of = min ingested across dimensions with a signal', async () => {
    const map = new Map([
      [
        'alpha',
        makeSignals({
          usageEvents: [makeUsageEvent({ quantity: 1 })],
          usageIngestedAt: '2026-06-25T12:00:05.000Z',
          humanReviews: [makeHumanReview({ thumbs: true })],
          reviewIngestedAt: '2026-06-25T11:00:00.000Z',
        }),
      ],
    ]);
    const view = await buildSkillsView(['alpha'], new FixtureSkillResolver(map));
    expect(view.asOf).toBe('2026-06-25T11:00:00.000Z');
  });
});
