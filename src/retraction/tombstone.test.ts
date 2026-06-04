/**
 * Tombstone generator tests (bead puxu.10).
 *
 *   - produces the append-only-honesty disclosure page with the correct
 *     reason_class wording.
 *   - passes the deploy HTML sanity gate (DOCTYPE + closing tag + stylesheet).
 *   - carries noindex; references the evals.* predicate URI, never labs.*.
 *   - is structurally C3-clean (no predicate-URI decision counts at all).
 */

import { describe, expect, it } from 'vitest';
import { renderTombstone, reasonSentence } from './tombstone.js';
import { scanForAggregatePass } from '../results/c3-scan.js';
import { type RetractionEntry, type RetractionReasonClass } from './denylist.js';

const ENTRY: RetractionEntry = {
  bundle_id: '0190b8e5-7c1a-7000-8000-000000000000',
  deep_url_path: '/results/iec/0190b8e5/',
  reason_class: 'consent-withdrawn',
  retracted_at: '2026-06-04T12:00:00Z',
  note: 'partner withdrew consent 2026-06-03',
  retracted_by: 'gc@intentsolutions.io',
};

describe('reasonSentence — closed set wording', () => {
  it('has plain-English wording for every closed-set member', () => {
    const set: RetractionReasonClass[] = [
      'partner-request',
      'methodology-error',
      'data-quality',
      'consent-withdrawn',
      'legal-hold',
      'pre-publication-recall',
    ];
    for (const r of set) {
      expect(reasonSentence(r).length).toBeGreaterThan(0);
    }
  });

  it('throws on an impossible out-of-set reason class (defence in depth)', () => {
    // The denylist validator rejects out-of-set values before they reach here;
    // this guards the noUncheckedIndexedAccess undefined branch.
    expect(() => reasonSentence('made-up' as unknown as RetractionReasonClass)).toThrow(
      /no tombstone wording/,
    );
  });
});

describe('renderTombstone — disclosure content', () => {
  const html = renderTombstone(ENTRY);

  it('states the attestation exists in the transparency log + chosen not to surface', () => {
    expect(html).toContain('exists in the transparency log');
    expect(html).toContain('chosen not to surface it');
  });

  it('includes the reason_class machine signal AND its plain-English wording', () => {
    expect(html).toContain('<code>consent-withdrawn</code>');
    expect(html).toContain(reasonSentence('consent-withdrawn'));
  });

  it('explains append-only honesty (cannot be un-logged, not deleted)', () => {
    expect(html.toLowerCase()).toContain('append-only');
    expect(html.toLowerCase()).toContain('cannot be un-logged');
    expect(html).toMatch(/does <strong>not<\/strong> delete/);
  });

  it('surfaces the optional operator note + retracted_by', () => {
    expect(html).toContain('partner withdrew consent 2026-06-03');
    expect(html).toContain('gc@intentsolutions.io');
  });

  it('references the evals.* predicate URI, never labs.*', () => {
    expect(html).toContain('https://evals.intentsolutions.io/retraction/v1');
    expect(html).not.toContain('labs.intentsolutions.io/retraction');
  });
});

describe('renderTombstone — deploy gate + C3 cleanliness', () => {
  const html = renderTombstone(ENTRY);

  it('passes the deploy HTML sanity gate (DOCTYPE + closing tag + stylesheet)', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<link rel="stylesheet" href="/style.css">');
  });

  it('carries noindex so crawlers drop the retracted URL', () => {
    expect(html).toContain('noindex');
  });

  it('is structurally C3-clean (no cross-predicate aggregate PASS%)', () => {
    expect(scanForAggregatePass(html)).toEqual([]);
  });

  it('does NOT declare a predicate URI under labs.* (CISO scan shape)', () => {
    expect(html).not.toMatch(/labs\.intentsolutions\.io\/[a-z-]+\/v[0-9]+/);
  });
});

describe('renderTombstone — minimal entry', () => {
  it('renders without optional note / retracted_by', () => {
    const html = renderTombstone({
      storage_key: 'sha256/ab/cd/abcd',
      deep_url_path: '/results/iah/x/',
      reason_class: 'data-quality',
      retracted_at: '2026-06-04T12:00:00Z',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('data-quality');
    expect(html).not.toContain('Operator note');
  });
});
