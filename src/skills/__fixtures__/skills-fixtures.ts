/**
 * Test fixtures for the per-skill signals module.
 *
 * Provides KERNEL-SCHEMA-VALID `UsageEvent` + `HumanReview` builders (so the
 * fixtures are realistic — they parse against `@intentsolutions/core`'s real
 * validators, exactly what a production resolver would re-validate) plus a
 * fixture {@link SkillSignalResolver} backed by an in-memory map.
 *
 * The builders go through the real kernel schemas via `parseUsageEvent` /
 * `parseHumanReview` so a fixture that drifts from the kernel contract fails
 * loudly in the test that builds it, not silently in render.
 */

import { UsageEventSchema, type UsageEvent } from '@intentsolutions/core/validators/v1/usage-event';
import {
  HumanReviewSchema,
  type HumanReview,
} from '@intentsolutions/core/validators/v1/human-review';
import {
  HUMAN_REVIEW_PREDICATE_URI,
  USAGE_PREDICATE_URI,
  type SkillSignalResolver,
  type SkillSignals,
} from '../skill-signal-model.js';

let uuidCounter = 0x100;
/** Deterministic distinct UUIDv7-shaped ids for fixtures. */
export function nextUuid(): string {
  uuidCounter += 1;
  const hex = uuidCounter.toString(16).padStart(12, '0');
  // UUIDv7 layout: time-high | 7 version | variant. Keep it parser-valid.
  return `01890a5d-ac96-7${hex.slice(0, 3)}-bcce-${hex.slice(0, 12).padEnd(12, '0')}`;
}

/** Build + KERNEL-VALIDATE a UsageEvent. Throws if the fixture is invalid. */
export function makeUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  const sourceId = nextUuid();
  const candidate = {
    id: nextUuid(),
    meter: 'skill_invocation',
    quantity: 1,
    unit: 'count',
    source_entity_type: 'skill_version',
    source_entity_id: sourceId,
    source_verified: true,
    cost_record_ref: null,
    recorded_at: '2026-06-25T12:00:00.000Z',
    ...overrides,
  };
  const parsed = UsageEventSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`fixture UsageEvent invalid: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

/** Build + KERNEL-VALIDATE a HumanReview. Throws if the fixture is invalid. */
export function makeHumanReview(overrides: Partial<HumanReview> = {}): HumanReview {
  const candidate = {
    id: nextUuid(),
    eval_run_id: nextUuid(),
    session_trace_id: nextUuid(),
    judge_decision_id: null,
    supersedes_id: null,
    reviewer_identity: 'github:jeremylongshore',
    reviewer_is_service_account: false,
    score_text: null,
    thumbs: true,
    annotation: null,
    input_hash: 'a'.repeat(64),
    created_at: '2026-06-25T12:00:00.000Z',
    ...overrides,
  };
  const parsed = HumanReviewSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`fixture HumanReview invalid: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data;
}

/** Build a SkillSignals bundle with sensible verified-ingest defaults. */
export function makeSignals(
  opts: {
    usageEvents?: readonly UsageEvent[];
    humanReviews?: readonly HumanReview[];
    rubricRef?: string | null;
    usageIngestedAt?: string | null;
    reviewIngestedAt?: string | null;
    qualityIngestedAt?: string | null;
  } = {},
): SkillSignals {
  return {
    usageEvents: opts.usageEvents ?? [],
    usagePredicateUri: USAGE_PREDICATE_URI,
    usageIngestedAt:
      opts.usageIngestedAt !== undefined
        ? opts.usageIngestedAt
        : (opts.usageEvents?.length ?? 0) > 0
          ? '2026-06-25T12:00:05.000Z'
          : null,
    humanReviews: opts.humanReviews ?? [],
    reviewPredicateUri: HUMAN_REVIEW_PREDICATE_URI,
    reviewIngestedAt:
      opts.reviewIngestedAt !== undefined
        ? opts.reviewIngestedAt
        : (opts.humanReviews?.length ?? 0) > 0
          ? '2026-06-25T12:00:06.000Z'
          : null,
    rubricRef: opts.rubricRef !== undefined ? opts.rubricRef : null,
    qualityIngestedAt:
      opts.qualityIngestedAt !== undefined
        ? opts.qualityIngestedAt
        : (opts.rubricRef ?? null) !== null
          ? '2026-06-25T12:00:07.000Z'
          : null,
  };
}

/**
 * A map-backed {@link SkillSignalResolver}: skill name → its signals. Skills
 * absent from the map resolve to null (an unknown skill → fully no-data card,
 * never a synthetic pass).
 */
export class FixtureSkillResolver implements SkillSignalResolver {
  constructor(private readonly map: Map<string, SkillSignals>) {}
  resolve(skill: string): Promise<SkillSignals | null> {
    return Promise.resolve(this.map.get(skill) ?? null);
  }
}
