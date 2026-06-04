/**
 * Visibility-tier gating tests (DR-035 C2).
 *
 * The core integrity property: a Tier-2 row WITHOUT a consent flag must be
 * ABSENT from the public output (effectively 404). Tier-1 (post-embargo) +
 * consented rows render publicly; Tier-3 never via this default path.
 */

import { describe, expect, it } from 'vitest';
import {
  decidePublicVisibility,
  filterPubliclyVisible,
  type RowVisibility,
} from './visibility.js';

const NOW = '2026-05-30T12:00:00.000Z';

describe('decidePublicVisibility', () => {
  it('Tier 1 with no embargo renders publicly', () => {
    expect(decidePublicVisibility({ tier: 'tier-1' }, NOW)).toEqual({ public: true });
  });

  it('Tier 1 with a PAST embargo renders publicly', () => {
    const v: RowVisibility = { tier: 'tier-1', embargoUntil: '2026-05-29T00:00:00.000Z' };
    expect(decidePublicVisibility(v, NOW)).toEqual({ public: true });
  });

  it('Tier 1 with a FUTURE embargo is absent (under embargo)', () => {
    const v: RowVisibility = { tier: 'tier-1', embargoUntil: '2026-06-30T00:00:00.000Z' };
    expect(decidePublicVisibility(v, NOW)).toEqual({
      public: false,
      reason: 'tier-1-under-embargo',
    });
  });

  it('Tier 1 with a MALFORMED embargo fails closed (treated as under embargo)', () => {
    const v: RowVisibility = { tier: 'tier-1', embargoUntil: 'not-a-date' };
    expect(decidePublicVisibility(v, NOW)).toEqual({
      public: false,
      reason: 'tier-1-under-embargo',
    });
  });

  it('Tier 2 WITHOUT consent is absent (the core gating rule)', () => {
    expect(decidePublicVisibility({ tier: 'tier-2' }, NOW)).toEqual({
      public: false,
      reason: 'tier-2-no-consent',
    });
  });

  it('Tier 2 with consent:false is absent', () => {
    expect(decidePublicVisibility({ tier: 'tier-2', consent: false }, NOW)).toEqual({
      public: false,
      reason: 'tier-2-no-consent',
    });
  });

  it('Tier 2 WITH consent renders publicly', () => {
    expect(decidePublicVisibility({ tier: 'tier-2', consent: true }, NOW)).toEqual({
      public: true,
    });
  });

  it('Tier 3 never renders publicly via the default path', () => {
    expect(decidePublicVisibility({ tier: 'tier-3' }, NOW)).toEqual({
      public: false,
      reason: 'tier-3-case-by-case',
    });
    // Even a consent flag does not promote a Tier-3 row on the default path.
    expect(decidePublicVisibility({ tier: 'tier-3', consent: true }, NOW)).toEqual({
      public: false,
      reason: 'tier-3-case-by-case',
    });
  });

  it('an unknown tier fails closed', () => {
    const v = { tier: 'tier-99' } as unknown as RowVisibility;
    expect(decidePublicVisibility(v, NOW)).toEqual({ public: false, reason: 'unknown-tier' });
  });

  it('a malformed now fails closed for an embargoed Tier-1 row', () => {
    const v: RowVisibility = { tier: 'tier-1', embargoUntil: '2026-06-30T00:00:00.000Z' };
    expect(decidePublicVisibility(v, 'garbage').public).toBe(false);
  });
});

describe('filterPubliclyVisible', () => {
  it('keeps only publicly-visible rows, in input order', () => {
    const rows = [
      { id: 'a', visibility: { tier: 'tier-1' } as RowVisibility },
      { id: 'b', visibility: { tier: 'tier-2' } as RowVisibility }, // dropped: no consent
      { id: 'c', visibility: { tier: 'tier-2', consent: true } as RowVisibility },
      { id: 'd', visibility: { tier: 'tier-3' } as RowVisibility }, // dropped
      { id: 'e', visibility: { tier: 'tier-1', embargoUntil: '2099-01-01T00:00:00Z' } as RowVisibility }, // dropped
    ];
    const kept = filterPubliclyVisible(rows, NOW);
    expect(kept.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns empty when every row is gated out', () => {
    const rows = [
      { id: 'x', visibility: { tier: 'tier-2' } as RowVisibility },
      { id: 'y', visibility: { tier: 'tier-3' } as RowVisibility },
    ];
    expect(filterPubliclyVisible(rows, NOW)).toEqual([]);
  });
});
