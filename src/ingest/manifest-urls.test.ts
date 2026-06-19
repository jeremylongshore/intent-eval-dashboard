/**
 * Manifest-URL resolver tests.
 *
 * Proves the resolver derives URLs from the pinned allowlist (single source of
 * truth), points iec at intent-eval-core's latest Release asset, and fails
 * closed on an unpinned repo.
 */

import { describe, expect, it } from 'vitest';
import { type PinnedSubjects } from './oidc-allowlist.js';
import {
  REPORT_MANIFEST_ASSET,
  makeManifestUrlResolver,
  manifestUrlForGithubRepo,
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
  },
};

describe('manifestUrlForGithubRepo', () => {
  it('builds the releases/latest asset URL', () => {
    expect(manifestUrlForGithubRepo('jeremylongshore/intent-eval-core')).toBe(
      `https://github.com/jeremylongshore/intent-eval-core/releases/latest/download/${REPORT_MANIFEST_ASSET}`,
    );
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

  it('fails closed on a repo absent from the pinned allowlist', () => {
    const resolve = makeManifestUrlResolver(PINNED);
    expect(() => resolve('rogue')).toThrow(/not in the pinned-subjects allowlist/);
  });
});
