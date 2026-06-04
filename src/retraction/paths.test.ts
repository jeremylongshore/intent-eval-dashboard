/**
 * Tombstone path derivation tests (bead puxu.10).
 *
 * The snippet's `rewrite` target and the tombstone's write location MUST agree.
 * These tests pin the single derivation both sides use.
 */

import { describe, expect, it } from 'vitest';
import { deepUrlSlug, tombstoneRepoPath, tombstoneSitePath, tombstoneUrl } from './paths.js';

describe('deepUrlSlug', () => {
  it('slugifies a results deep URL deterministically', () => {
    expect(deepUrlSlug('/results/iec/0190b8e5/')).toBe('results-iec-0190b8e5');
  });

  it('is stable regardless of leading/trailing slashes', () => {
    expect(deepUrlSlug('/results/iec/x')).toBe(deepUrlSlug('/results/iec/x/'));
  });

  it('collapses a bare root to a stable slug', () => {
    expect(deepUrlSlug('/')).toBe('root');
  });
});

describe('tombstone path agreement (snippet rewrite == tombstone write target)', () => {
  it('site path and repo path point at the same file', () => {
    const deep = '/results/iah/deadbeef/';
    // Caddy rewrite target (leading slash) and repo write path (no leading slash)
    // must differ ONLY by the leading slash + the index.html being shared.
    expect(tombstoneSitePath(deep)).toBe('/' + tombstoneRepoPath(deep));
    expect(tombstoneUrl(deep)).toBe('/retracted/results-iah-deadbeef/');
    expect(tombstoneRepoPath(deep)).toBe('retracted/results-iah-deadbeef/index.html');
  });
});
