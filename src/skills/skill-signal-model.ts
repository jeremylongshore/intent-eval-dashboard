/**
 * Per-skill signal view-model — the wave-2 adoption + human-trust surface.
 *
 * This is the `src/skills/` sibling of `src/results/row-model.ts`. It bridges
 * VERIFIED kernel entities (`@intentsolutions/core@^0.9.0`'s 15th entity
 * `UsageEvent` + the net-new `HumanReview`) into renderable PER-SKILL,
 * PER-DIMENSION cards. The adoption-score values are produced upstream by j-rig;
 * this repo is a pure CONSUMER — it renders against the kernel entity types
 * through a clean {@link SkillSignalResolver} seam, never against a parallel
 * ingest path.
 *
 * ── C3 binding (DR-035 § 4 C3 + DR-103 C3) — STRUCTURAL, not a regex ──
 * The hard refusal is a ROLLED aggregate score across heterogeneous predicates
 * or dimensions. We defend it the only durable way: by SHAPE. The view-model has
 * NO field that could carry a cross-dimension scalar:
 *
 *   - {@link SkillCard} has NO `rolledScore`, NO `overallScore`, NO `passPct`
 *     field. There is deliberately no place to put one.
 *   - Each dimension ({@link AdoptionSignal}, {@link HumanTrustSignal},
 *     {@link QualitySignal}) is a SEPARATE, self-contained object with its OWN
 *     provenance + predicate URI. They are never summed, averaged, or combined.
 *   - No code path in this file reduces two dimensions into one number.
 *
 * ── Anti-arithmetic (DR-103 Item 6 HARDEN Rule 1) ──
 * The renderer must show only counts the upstream kernel entities ALREADY carry
 * (e.g. a verified `UsageEvent.quantity`); it must NOT divide or ratio anything.
 * To make that enforceable, this model exposes RAW VERIFIED COUNTS only — there
 * is no derived-rate field for a renderer to print. A rate, if ever shown, must
 * be a field the kernel `usage_events` entity computes and emits INSIDE the
 * verified bundle; it is not synthesised here.
 *
 * ── Freshness (DR-035 C4) ──
 * Absence is LOUD, never blanked or back-filled. A skill with no verified
 * adoption signal is `noData: true` on that dimension and renders with
 * fail-equal weight — exactly like the results browser's `no-data` panel.
 */

import type { UsageEvent } from '@intentsolutions/core/validators/v1/usage-event';
import type { HumanReview } from '@intentsolutions/core/validators/v1/human-review';

/**
 * Per-dimension provenance — where a dimension's signal came from + the
 * predicate URI it attests against. Predicate URIs are only ever RENDERED here
 * (pointed at `evals.*`); this surface never DECLARES one at `labs.*` (CISO
 * binding, DR-035 § 8).
 */
export interface SignalProvenance {
  /**
   * Canonical predicate URI the dimension's signal attests against
   * (e.g. `https://evals.intentsolutions.io/human-review/v1`). Rendered as data,
   * never declared by this page.
   */
  readonly predicateUri: string;
  /**
   * RFC-3339 timestamp this dashboard verified + ingested the signal. Part of
   * the freshness surface — never collapsed away.
   */
  readonly ingestedAt: string;
}

/**
 * The ADOPTION dimension for one skill, projected from VERIFIED `UsageEvent`
 * rows (the kernel's 15th entity). A pure, raw, per-`(meter, unit)` count
 * breakdown — NEVER a cross-`(meter, unit)` SUM (DR-103 C3) and NEVER a rate.
 *
 * Each entry is one homogeneous `(meter, unit)` pair with its summed verified
 * `quantity`. Summing within ONE `(meter, unit)` pair is homogeneous and
 * allowed; summing ACROSS pairs is the forbidden laundering and is structurally
 * impossible here (the breakdown is a list, never reduced to a scalar).
 */
export interface AdoptionSignal {
  readonly provenance: SignalProvenance;
  /**
   * One row per distinct `(meter, unit)` pair. The `count` is the sum of
   * verified `quantity` WITHIN that single homogeneous pair only. Heterogeneous
   * pairs are listed side by side, never combined.
   */
  readonly perMeter: readonly AdoptionMeterCount[];
  /** True when this skill has ZERO verified adoption events (loud no-data). */
  readonly noData: boolean;
}

/** A single homogeneous `(meter, unit)` verified count. Never cross-summed. */
export interface AdoptionMeterCount {
  /** The kernel `UsageEvent.meter` (closed pricing enum value). */
  readonly meter: UsageEvent['meter'];
  /** The kernel `UsageEvent.unit` (closed enum value). */
  readonly unit: UsageEvent['unit'];
  /**
   * Sum of verified `quantity` for THIS `(meter, unit)` pair only. A raw count
   * the renderer prints verbatim — never divided or ratioed.
   */
  readonly count: number;
  /** How many distinct verified `UsageEvent` rows fed this count. */
  readonly eventCount: number;
}

/**
 * The HUMAN-TRUST dimension for one skill, projected from VERIFIED `HumanReview`
 * rows. The three kernel channels (`thumbs`, `score_text`, `annotation`) stay
 * ORTHOGONAL (DR-103 C3): they are surfaced as SEPARATE tallies / lists, never
 * folded into a single trust scalar.
 *
 * `score_text` is NON-COMPARABLE free text — it is listed verbatim, never parsed
 * into a number or aggregated.
 */
export interface HumanTrustSignal {
  readonly provenance: SignalProvenance;
  /** Count of verified reviews with `thumbs === true`. Raw count, not a ratio. */
  readonly thumbsUp: number;
  /** Count of verified reviews with `thumbs === false`. Raw count, not a ratio. */
  readonly thumbsDown: number;
  /**
   * Non-comparable free-text assessments (`HumanReview.score_text`), verbatim.
   * Never parsed into a scalar or aggregated.
   */
  readonly scoreTexts: readonly string[];
  /** Open-ended annotations (`HumanReview.annotation`), verbatim. */
  readonly annotations: readonly string[];
  /** Total verified human reviews backing this dimension. */
  readonly reviewCount: number;
  /** True when this skill has ZERO verified human reviews (loud no-data). */
  readonly noData: boolean;
}

/**
 * The QUALITY dimension for one skill. Per DR-103 Item 6 the rubric SCORE itself
 * is delegated BACK to `validate-skillmd` unchanged — this surface does NOT
 * reimplement it. We render only a LINK out to where the rubric grade lives,
 * plus its provenance. There is intentionally no quality scalar stored here, so
 * it can never be combined with the other dimensions.
 */
export interface QualitySignal {
  readonly provenance: SignalProvenance;
  /**
   * Where the rubric grade lives (the validate-skillmd surface). The grade is
   * NOT inlined or combined — only linked, keeping the dimension orthogonal.
   */
  readonly rubricRef: string | null;
  /** True when no rubric reference is available for this skill (loud no-data). */
  readonly noData: boolean;
}

/**
 * One skill's full per-dimension card.
 *
 * STRUCTURAL C3 GUARANTEE: there is NO aggregate field. The three dimensions are
 * independent siblings; nothing in this type (or anywhere in this module)
 * reduces them to a single skill-level "score" or "pass %". A reviewer can
 * verify the C3 binding by reading this interface: the absence is the defence.
 */
export interface SkillCard {
  /** Stable skill identity (e.g. the skill name / slug). */
  readonly skill: string;
  /** The adoption dimension (verified UsageEvent projection). */
  readonly adoption: AdoptionSignal;
  /** The human-trust dimension (verified HumanReview projection). */
  readonly humanTrust: HumanTrustSignal;
  /** The quality dimension (link-out to the validate-skillmd rubric). */
  readonly quality: QualitySignal;
}

/** The full skills view across all skills. */
export interface SkillsView {
  /**
   * Global "as-of" = min(ingestedAt) across every dimension that HAS a verified
   * signal. Undefined when nothing has been ingested yet (the honest current
   * state). Truthful about the staleness floor of the whole page.
   */
  readonly asOf?: string;
  readonly skills: readonly SkillCard[];
}

/**
 * The verified per-skill signal inputs, as a resolver returns them.
 *
 * The resolver is the clean data SEAM the upstream pipeline wires into. It
 * returns ONLY verified kernel entities + the predicate URI each attests
 * against. Returning empty arrays is the LOUD no-data state, never a synthetic
 * pass. A production resolver re-validates each entity against the kernel
 * schemas before returning it (verify-before-render); the fixture resolver
 * returns kernel-valid fixtures.
 */
export interface SkillSignals {
  /** Verified `UsageEvent` rows attributed to this skill. */
  readonly usageEvents: readonly UsageEvent[];
  /** Predicate URI the adoption signal attests against (rendered, not declared). */
  readonly usagePredicateUri: string;
  /** RFC-3339 ingest timestamp for the adoption signal. */
  readonly usageIngestedAt: string | null;
  /** Verified `HumanReview` rows attributed to this skill. */
  readonly humanReviews: readonly HumanReview[];
  /** Predicate URI the human-trust signal attests against. */
  readonly reviewPredicateUri: string;
  /** RFC-3339 ingest timestamp for the human-trust signal. */
  readonly reviewIngestedAt: string | null;
  /** Where the validate-skillmd rubric grade lives, or null if none. */
  readonly rubricRef: string | null;
  /** RFC-3339 ingest timestamp for the quality signal, or null. */
  readonly qualityIngestedAt: string | null;
}

/**
 * Resolves the verified signal inputs for ONE skill, or null if the skill is
 * unknown. Production impl re-validates against the kernel schemas; the fixture
 * impl is an in-memory map. `null` => unknown skill (a hole, never a pass).
 */
export interface SkillSignalResolver {
  /** Resolve one skill's verified signals, or null if unknown/unresolvable. */
  resolve(skill: string): Promise<SkillSignals | null>;
}

/** Empty provenance placeholder for a no-data dimension. */
function emptyProvenance(predicateUri: string): SignalProvenance {
  return { predicateUri, ingestedAt: '' };
}

/**
 * Build the ADOPTION dimension from verified usage events.
 *
 * Counts are summed STRICTLY within each `(meter, unit)` pair — a homogeneous,
 * C3-safe operation. There is NO cross-pair sum: heterogeneous pairs stay as
 * distinct rows. Zero events => loud no-data.
 */
export function buildAdoptionSignal(
  usageEvents: readonly UsageEvent[],
  predicateUri: string,
  ingestedAt: string | null,
): AdoptionSignal {
  if (usageEvents.length === 0) {
    return { provenance: emptyProvenance(predicateUri), perMeter: [], noData: true };
  }
  // Key by the homogeneous (meter, unit) pair. Summing within a key is allowed;
  // there is no code path that adds across keys.
  const byPair = new Map<string, { count: number; eventCount: number }>();
  for (const ev of usageEvents) {
    const key = `${ev.meter} ${ev.unit}`;
    const acc = byPair.get(key) ?? { count: 0, eventCount: 0 };
    acc.count += ev.quantity;
    acc.eventCount += 1;
    byPair.set(key, acc);
  }
  const perMeter: AdoptionMeterCount[] = [...byPair.entries()].map(([key, acc]) => {
    const [meter, unit] = key.split(' ');
    return {
      meter: meter as UsageEvent['meter'],
      unit: unit as UsageEvent['unit'],
      count: acc.count,
      eventCount: acc.eventCount,
    };
  });
  return {
    provenance: { predicateUri, ingestedAt: ingestedAt ?? '' },
    perMeter,
    noData: false,
  };
}

/**
 * Build the HUMAN-TRUST dimension from verified human reviews.
 *
 * The three kernel channels stay ORTHOGONAL: thumbs are tallied (up/down kept
 * SEPARATE — never collapsed into a net or a ratio), score_text + annotation are
 * listed verbatim. Zero reviews => loud no-data.
 */
export function buildHumanTrustSignal(
  humanReviews: readonly HumanReview[],
  predicateUri: string,
  ingestedAt: string | null,
): HumanTrustSignal {
  if (humanReviews.length === 0) {
    return {
      provenance: emptyProvenance(predicateUri),
      thumbsUp: 0,
      thumbsDown: 0,
      scoreTexts: [],
      annotations: [],
      reviewCount: 0,
      noData: true,
    };
  }
  let thumbsUp = 0;
  let thumbsDown = 0;
  const scoreTexts: string[] = [];
  const annotations: string[] = [];
  for (const rev of humanReviews) {
    if (rev.thumbs === true) thumbsUp += 1;
    else if (rev.thumbs === false) thumbsDown += 1;
    if (rev.score_text !== null && rev.score_text.length > 0) scoreTexts.push(rev.score_text);
    if (rev.annotation !== null && rev.annotation.length > 0) annotations.push(rev.annotation);
  }
  return {
    provenance: { predicateUri, ingestedAt: ingestedAt ?? '' },
    thumbsUp,
    thumbsDown,
    scoreTexts,
    annotations,
    reviewCount: humanReviews.length,
    noData: false,
  };
}

/** Build the QUALITY dimension (link-out only; no scalar stored). */
export function buildQualitySignal(
  rubricRef: string | null,
  predicateUri: string,
  ingestedAt: string | null,
): QualitySignal {
  return {
    provenance: { predicateUri, ingestedAt: ingestedAt ?? '' },
    rubricRef,
    noData: rubricRef === null,
  };
}

/**
 * Build one skill's card from its resolved signals.
 *
 * A resolver may omit a per-dimension predicate URI (empty string); the default
 * `evals.*` URI for that dimension is substituted. Quality always points at the
 * rubric (validate-skillmd) surface.
 */
export function buildSkillCard(skill: string, signals: SkillSignals): SkillCard {
  const usageUri =
    signals.usagePredicateUri.length > 0 ? signals.usagePredicateUri : USAGE_PREDICATE_URI;
  const reviewUri =
    signals.reviewPredicateUri.length > 0 ? signals.reviewPredicateUri : HUMAN_REVIEW_PREDICATE_URI;
  return {
    skill,
    adoption: buildAdoptionSignal(signals.usageEvents, usageUri, signals.usageIngestedAt),
    humanTrust: buildHumanTrustSignal(signals.humanReviews, reviewUri, signals.reviewIngestedAt),
    quality: buildQualitySignal(
      signals.rubricRef,
      QUALITY_PREDICATE_URI,
      signals.qualityIngestedAt,
    ),
  };
}

/**
 * Build the full skills view from a list of skill names + a resolver.
 *
 * Unknown skills (resolver returns null) render as fully-no-data cards — every
 * dimension loud, never a synthetic pass. The `asOf` banner is min(ingestedAt)
 * across every dimension that actually has a verified signal.
 */
export async function buildSkillsView(
  skills: readonly string[],
  resolver: SkillSignalResolver,
): Promise<SkillsView> {
  const cards: SkillCard[] = [];
  const ingestTimes: string[] = [];

  for (const skill of skills) {
    const signals = await resolver.resolve(skill);
    if (signals === null) {
      cards.push(noDataCard(skill));
      continue;
    }
    const card = buildSkillCard(skill, signals);
    cards.push(card);
    collectIngest(ingestTimes, card);
  }

  const asOf =
    ingestTimes.length > 0 ? ingestTimes.reduce((min, t) => (t < min ? t : min)) : undefined;
  return { ...(asOf !== undefined ? { asOf } : {}), skills: cards };
}

/** A fully no-data card for an unknown skill. */
function noDataCard(skill: string): SkillCard {
  return {
    skill,
    adoption: buildAdoptionSignal([], USAGE_PREDICATE_URI, null),
    humanTrust: buildHumanTrustSignal([], HUMAN_REVIEW_PREDICATE_URI, null),
    quality: buildQualitySignal(null, QUALITY_PREDICATE_URI, null),
  };
}

/** Gather the non-empty ingest timestamps from a built card. */
function collectIngest(into: string[], card: SkillCard): void {
  for (const ts of [
    card.adoption.provenance.ingestedAt,
    card.humanTrust.provenance.ingestedAt,
    card.quality.provenance.ingestedAt,
  ]) {
    if (ts.length > 0) into.push(ts);
  }
}

/**
 * Default predicate URIs each dimension attests against. Adoption rides inside
 * an EvidenceStatement's `extensions` (UsageEvent has no own predicate per
 * DR-103), so it points at the gate-result attestation surface; human-trust has
 * its own `human-review/v1` predicate; quality points at the rubric surface.
 * All at `evals.*` — never `labs.*`.
 */
export const USAGE_PREDICATE_URI = 'https://evals.intentsolutions.io/gate-result/v1';
export const HUMAN_REVIEW_PREDICATE_URI = 'https://evals.intentsolutions.io/human-review/v1';
export const QUALITY_PREDICATE_URI = 'https://evals.intentsolutions.io/validation-result/v1';
