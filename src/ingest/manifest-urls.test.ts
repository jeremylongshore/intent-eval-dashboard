/**
 * Manifest-URL resolver tests.
 *
 * Proves the resolver derives URLs from the pinned allowlist (single source of
 * truth), points iec at intent-eval-core's latest Release asset, honors a
 * pinned `manifestTag` override (ccp's fixed `evidence-latest` tag), and fails
 * closed on an unpinned repo.
 */

import { describe, expect, it } from 'vitest';
import { type PinnedSubjects } from './oidc-allowlist.js';
import {
  REPORT_MANIFEST_ASSET,
  makeManifestUrlResolver,
  manifestUrlForGithubRepo,
  manifestUrlForGithubRepoTag,
} from './manifest-urls.js';

const PINNED: PinnedSubjects = {
  issuer: 'https://token.actions.githubusercontent.com',
  repos: {
    iec: {
      githubRepo: 'jeremylongshore/intent-eval-core',
      subjects: ['repo:jeremylongshore/intent-eval-core:ref:refs/tags/*'],
      workflowRefs: ['jeremylongshore/intent-eval-core/.github/workflows/release.yml@refs/tags/*'],
      operatorConfirmed: true,
    },
    iel: {
      githubRepo: 'jeremylongshore/intent-eval-lab',
      subjects: ['repo:jeremylongshore/intent-eval-lab:ref:refs/tags/*'],
      workflowRefs: [
        'jeremylongshore/intent-eval-lab/.github/workflows/release.yml@refs/heads/main',
      ],
      operatorConfirmed: false,
    },
    ccp: {
      githubRepo: 'jeremylongshore/claude-code-plugins-plus-skills',
      subjects: ['repo:jeremylongshore/claude-code-plugins-plus-skills:ref:refs/heads/main'],
      workflowRefs: [
        'jeremylongshore/claude-code-plugins-plus-skills/.github/workflows/emit-evidence.yml@refs/heads/main',
      ],
      manifestTag: 'evidence-latest',
      operatorConfirmed: false,
    },
    jrig: {
      githubRepo: 'jeremylongshore/j-rig-skill-binary-eval',
      subjects: ['repo:jeremylongshore/j-rig-skill-binary-eval:ref:refs/heads/main'],
      workflowRefs: [
        'jeremylongshore/j-rig-skill-binary-eval/.github/workflows/nightly-skill-evals.yml@refs/heads/main',
      ],
      manifestTag: 'evidence-latest',
      operatorConfirmed: false,
    },
    qmd: {
      githubRepo: 'jeremylongshore/bobs-big-brain-registrar',
      subjects: [
        'repo:jeremylongshore/qmd-team-intent-kb:ref:refs/heads/main',
        'repo:jeremylongshore/bobs-big-brain-registrar:ref:refs/heads/main',
      ],
      workflowRefs: [
        'jeremylongshore/qmd-team-intent-kb/.github/workflows/emit-evidence.yml@refs/heads/main',
        'jeremylongshore/bobs-big-brain-registrar/.github/workflows/emit-evidence.yml@refs/heads/main',
      ],
      manifestTag: 'evidence-latest',
      operatorConfirmed: false,
    },
  },
};

describe('manifestUrlForGithubRepo', () => {
  it('builds the releases/latest asset URL', () => {
    expect(manifestUrlForGithubRepo('jeremylongshore/intent-eval-core')).toBe(
      `https://github.com/jeremylongshore/intent-eval-core/releases/latest/download/${REPORT_MANIFEST_ASSET}`,
    );
  });
});

describe('manifestUrlForGithubRepoTag', () => {
  it('builds the fixed-tag asset URL', () => {
    expect(
      manifestUrlForGithubRepoTag(
        'jeremylongshore/claude-code-plugins-plus-skills',
        'evidence-latest',
      ),
    ).toBe(
      `https://github.com/jeremylongshore/claude-code-plugins-plus-skills/releases/download/evidence-latest/${REPORT_MANIFEST_ASSET}`,
    );
  });

  it('refuses an empty or whitespace tag', () => {
    expect(() => manifestUrlForGithubRepoTag('owner/repo', '')).toThrow(/empty parts/);
    expect(() => manifestUrlForGithubRepoTag('owner/repo', '   ')).toThrow(/empty parts/);
  });

  it('refuses an empty or whitespace githubRepo', () => {
    expect(() => manifestUrlForGithubRepoTag('', 'evidence-latest')).toThrow(/empty parts/);
    expect(() => manifestUrlForGithubRepoTag('  ', 'evidence-latest')).toThrow(/empty parts/);
  });
});

describe('makeManifestUrlResolver', () => {
  it('resolves iec to intent-eval-core latest Release manifest asset', () => {
    const resolve = makeManifestUrlResolver(PINNED);
    expect(resolve('iec')).toBe(
      'https://github.com/jeremylongshore/intent-eval-core/releases/latest/download/report-manifest.json',
    );
  });

  it('resolves a second pinned repo from the same allowlist', () => {
    const resolve = makeManifestUrlResolver(PINNED);
    expect(resolve('iel')).toBe(
      'https://github.com/jeremylongshore/intent-eval-lab/releases/latest/download/report-manifest.json',
    );
  });

  it('resolves a manifestTag-pinned repo to the fixed-tag URL, not releases/latest', () => {
    const resolve = makeManifestUrlResolver(PINNED);
    expect(resolve('ccp')).toBe(
      'https://github.com/jeremylongshore/claude-code-plugins-plus-skills/releases/download/evidence-latest/report-manifest.json',
    );
  });

  it('resolves jrig (second channel on j-rig-skill-binary-eval) to its fixed evidence-latest tag', () => {
    const resolve = makeManifestUrlResolver(PINNED);
    expect(resolve('jrig')).toBe(
      'https://github.com/jeremylongshore/j-rig-skill-binary-eval/releases/download/evidence-latest/report-manifest.json',
    );
  });

  it('resolves qmd (a repo that cuts no Releases) to its fixed evidence-latest tag', () => {
    const resolve = makeManifestUrlResolver(PINNED);
    expect(resolve('qmd')).toBe(
      'https://github.com/jeremylongshore/bobs-big-brain-registrar/releases/download/evidence-latest/report-manifest.json',
    );
  });

  it('fails closed on a repo absent from the pinned allowlist', () => {
    const resolve = makeManifestUrlResolver(PINNED);
    expect(() => resolve('rogue')).toThrow(/not in the pinned-subjects allowlist/);
  });
});
