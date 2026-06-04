/**
 * Caddy snippet generator tests (bead puxu.10).
 *
 *   - a retraction entry -> generated snippet contains a 410 directive for that
 *     deep URL.
 *   - an EMPTY denylist -> a valid no-op snippet (no handle blocks).
 *   - the snippet documents the human-gated VPS deploy (no rebuild) and the
 *     reload-not-restart rule.
 */

import { describe, expect, it } from 'vitest';
import { renderSnippet } from './snippet.js';
import { tombstoneSitePath } from './paths.js';
import { type RetractionEntry } from './denylist.js';

const ENTRY: RetractionEntry = {
  bundle_id: '0190b8e5-7c1a-7000-8000-000000000000',
  deep_url_path: '/results/iec/0190b8e5/',
  reason_class: 'partner-request',
  retracted_at: '2026-06-04T12:00:00Z',
};

describe('renderSnippet — non-empty', () => {
  const snippet = renderSnippet([ENTRY]);

  it('contains a 410 status directive for the retracted deep URL', () => {
    expect(snippet).toContain('status 410');
  });

  it('matches the retracted deep URL path in a handle block', () => {
    expect(snippet).toContain(`handle ${ENTRY.deep_url_path}`);
  });

  it('rewrites to the deterministic tombstone file path', () => {
    expect(snippet).toContain(`rewrite * ${tombstoneSitePath(ENTRY.deep_url_path)}`);
  });

  it('tags the response with the reason_class header', () => {
    expect(snippet).toContain('X-IEP-Retraction-Reason "partner-request"');
  });

  it('matches both the trailing-slash and non-slash forms', () => {
    // The entry path ends with `/`; the non-slash variant must also be matched.
    expect(snippet).toContain('/results/iec/0190b8e5');
  });

  it('documents the reload-not-restart + no-rebuild deploy contract', () => {
    expect(snippet).toContain('systemctl reload caddy');
    expect(snippet).toContain('NEVER restart');
    expect(snippet).toMatch(/DO NOT EDIT BY HAND/);
  });
});

describe('renderSnippet — empty (no-op)', () => {
  const snippet = renderSnippet([]);

  it('is a valid no-op snippet with NO handle blocks', () => {
    expect(snippet).not.toContain('handle ');
    expect(snippet).not.toContain('status 410');
    expect(snippet).toContain('(no retractions');
  });

  it('still imports cleanly (header present)', () => {
    expect(snippet).toContain('retractions.snippet');
  });
});

describe('renderSnippet — non-trailing-slash deep URL', () => {
  it('matches the path + its trailing-slash variant', () => {
    const entry: RetractionEntry = {
      bundle_id: '0190b8e5-7c1a-7000-8000-000000000000',
      deep_url_path: '/results/iec/no-slash',
      reason_class: 'data-quality',
      retracted_at: '2026-06-04T12:00:00Z',
    };
    const snippet = renderSnippet([entry]);
    expect(snippet).toContain('handle /results/iec/no-slash /results/iec/no-slash/');
    expect(snippet).toContain('status 410');
  });
});

describe('renderSnippet — multiple entries', () => {
  it('emits one handle block per retraction', () => {
    const second: RetractionEntry = {
      content_hash: 'sha256:' + 'b'.repeat(64),
      deep_url_path: '/results/iah/deadbeef/',
      reason_class: 'methodology-error',
      retracted_at: '2026-06-04T13:00:00Z',
    };
    const snippet = renderSnippet([ENTRY, second]);
    const blocks = snippet.match(/\bhandle \//g) ?? [];
    expect(blocks.length).toBe(2);
    expect(snippet).toContain('reason_class=partner-request');
    expect(snippet).toContain('reason_class=methodology-error');
  });
});
