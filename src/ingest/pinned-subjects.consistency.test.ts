import { describe, it, expect } from 'vitest';
import { loadPinnedSubjects, parsePinnedSubjects, pinConsistencyIssues } from './pinned-loader.js';

/**
 * Regression for the 2026-08-26 → 09-06 marketplace blackout: the source repo
 * was renamed on GitHub, every new Fulcio certificate carried the new slug in
 * its OIDC subject, and the pin still named the old one. Ingest reported
 * `ccp: no-data (verify_oidc/oidc_subject_mismatch)` for twelve nights while
 * the renderer served the last-known-good snapshot behind a stale badge.
 * Nothing in the repo caught it because nothing checked that a pin agrees with
 * itself. This does.
 */
describe('pinned-subjects consistency', () => {
  it('every shipped pin names its own githubRepo in subjects and workflowRefs', async () => {
    const doc = await loadPinnedSubjects();
    expect(pinConsistencyIssues(doc)).toEqual([]);
  });

  it('the marketplace pin follows the 2026-08 rename to tons-of-skills-marketplace', async () => {
    const doc = await loadPinnedSubjects();
    const ccp = doc.repos['ccp'];
    expect(ccp).toBeDefined();
    expect(ccp?.githubRepo).toBe('jeremylongshore/tons-of-skills-marketplace');
    expect(ccp?.subjects).toEqual([
      'repo:jeremylongshore/tons-of-skills-marketplace:ref:refs/heads/main',
    ]);
    expect(ccp?.workflowRefs).toEqual([
      'jeremylongshore/tons-of-skills-marketplace/.github/workflows/emit-evidence.yml@refs/heads/main',
    ]);
  });

  it('NEGATIVE: a pin whose subject still names the pre-rename slug is reported (the mutant is caught)', () => {
    const mutant = parsePinnedSubjects({
      issuer: 'https://token.actions.githubusercontent.com',
      repos: {
        ccp: {
          githubRepo: 'jeremylongshore/tons-of-skills-marketplace',
          subjects: ['repo:jeremylongshore/claude-code-plugins-plus-skills:ref:refs/heads/main'],
          workflowRefs: [
            'jeremylongshore/claude-code-plugins-plus-skills/.github/workflows/emit-evidence.yml@refs/heads/main',
          ],
          manifestTag: 'evidence-latest',
          operatorConfirmed: true,
        },
      },
    });
    const issues = pinConsistencyIssues(mutant);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain('does not name githubRepo');
    expect(issues[1]).toContain('does not start with githubRepo');
  });
});
