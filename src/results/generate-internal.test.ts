/**
 * Operator-internal generator tests (bead puxu.9).
 *
 * The KEY integrity assertion is the INVERSE-OF-PUBLIC test: a fixture carrying a
 * Tier-2-no-consent bundle, an embargoed Tier-1 bundle, and a Tier-3 bundle:
 *   - the PUBLIC generator OMITS all three (proven in generate.test.ts);
 *   - the INTERNAL generator INCLUDES all three (their keys + deep-link pages
 *     ARE present in the `site-internal/` output).
 * This proves the operator view shows exactly what the public view hides.
 *
 * Also asserts:
 *   - internal output is written under `site-internal/`, NEVER `site/`;
 *   - the 4-timestamp surface renders on the internal pages;
 *   - the USE-method view renders on the internal index;
 *   - each row carries a visibility-tier badge (the operator "why public/not");
 *   - the internal output stays C3-clean (no cross-predicate aggregate PASS%).
 */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildInternalResultsView,
  buildInternalUse,
  deriveLiveness,
  generateInternalFiles,
  pathFromInternalUrl,
  writeInternalSite,
} from './generate-internal.js';
import { buildPublicResultsView, generateResultsFiles } from './generate.js';
import { internalBundleUrl, internalRepoUrl } from './render-internal.js';
import { scanForAggregatePass } from './c3-scan.js';
import {
  FixtureResolver,
  GATE_RESULT_URI,
  VALIDATION_URI,
  renderInput,
  repoState,
  resolvedRow,
} from './__fixtures__/results-fixtures.js';

const NOW = '2026-05-30T12:00:00.000Z';
// An embargo far in the future relative to NOW — keeps the Tier-1 row hidden publicly.
const FUTURE_EMBARGO = '2099-01-01T00:00:00.000Z';

/** A fixture with exactly one bundle per visibility class. */
function mixedTierResolver(opts: {
  kPublic: string;
  kNoConsent: string;
  kEmbargoed: string;
  kTier3: string;
}): FixtureResolver {
  return new FixtureResolver(
    new Map([
      [opts.kPublic, [resolvedRow({ gateName: 'public-pass', visibility: { tier: 'tier-1' } })]],
      [
        opts.kNoConsent,
        [resolvedRow({ gateName: 'partner-internal', visibility: { tier: 'tier-2' } })],
      ],
      [
        opts.kEmbargoed,
        [
          resolvedRow({
            gateName: 'embargoed-tier1',
            visibility: { tier: 'tier-1', embargoUntil: FUTURE_EMBARGO },
          }),
        ],
      ],
      [opts.kTier3, [resolvedRow({ gateName: 'third-party', visibility: { tier: 'tier-3' } })]],
    ]),
  );
}

describe('buildInternalResultsView (no public filter)', () => {
  it('includes EVERY tier — Tier-2-no-consent, Tier-3, embargoed Tier-1 all present', async () => {
    const k = 'sha256:' + 'a'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([
        [
          k,
          [
            resolvedRow({ gateName: 'public', visibility: { tier: 'tier-1' } }),
            resolvedRow({ gateName: 'no-consent', visibility: { tier: 'tier-2' } }),
            resolvedRow({ gateName: 'third-party', visibility: { tier: 'tier-3' } }),
            resolvedRow({
              gateName: 'embargoed',
              visibility: { tier: 'tier-1', embargoUntil: FUTURE_EMBARGO },
            }),
          ],
        ],
      ]),
    );
    const view = await buildInternalResultsView(
      renderInput([repoState('iec', { bundleKeys: [k] })]),
      resolver,
    );
    expect(view.repos[0]?.rows.map((r) => r.gateName)).toEqual([
      'public',
      'no-consent',
      'third-party',
      'embargoed',
    ]);
    expect(view.repos[0]?.noData).toBe(false);
  });
});

describe('INVERSE-OF-PUBLIC: internal shows what public hides', () => {
  const kPublic = 'sha256:' + '1'.repeat(64);
  const kNoConsent = 'sha256:' + '2'.repeat(64);
  const kEmbargoed = 'sha256:' + '3'.repeat(64);
  const kTier3 = 'sha256:' + '4'.repeat(64);

  function input() {
    return renderInput([
      repoState('iec', { bundleKeys: [kPublic, kNoConsent, kEmbargoed, kTier3] }),
    ]);
  }

  it('PUBLIC generator OMITS the three non-public bundles (only the public one survives)', async () => {
    const resolver = mixedTierResolver({ kPublic, kNoConsent, kEmbargoed, kTier3 });
    const pubView = await buildPublicResultsView(input(), resolver, NOW);
    const pubFiles = generateResultsFiles(pubView);
    const pubHtml = pubFiles.map((f) => f.html).join('\n');
    const pubPaths = pubFiles.map((f) => f.path);

    // The public deep-link page exists only for the public bundle.
    expect(pubPaths.some((p) => p.includes('1111111'))).toBe(true);
    expect(pubHtml).toContain(kPublic);
    // The three non-public bundle keys appear NOWHERE in the public output.
    expect(pubHtml).not.toContain(kNoConsent);
    expect(pubHtml).not.toContain(kEmbargoed);
    expect(pubHtml).not.toContain(kTier3);
  });

  it('INTERNAL generator INCLUDES all four bundles — keys + deep-link pages present', async () => {
    const resolver = mixedTierResolver({ kPublic, kNoConsent, kEmbargoed, kTier3 });
    const view = await buildInternalResultsView(input(), resolver);
    const use = buildInternalUse(view, NOW);
    const files = generateInternalFiles(view, use, NOW);
    const paths = files.map((f) => f.path);
    const html = files.map((f) => f.html).join('\n');

    // A per-bundle deep-link page is generated for EVERY bundle, including the
    // ones the public site hides.
    expect(paths).toContain(pathFromInternalUrl(internalBundleUrl('iec', kPublic)));
    expect(paths).toContain(pathFromInternalUrl(internalBundleUrl('iec', kNoConsent)));
    expect(paths).toContain(pathFromInternalUrl(internalBundleUrl('iec', kEmbargoed)));
    expect(paths).toContain(pathFromInternalUrl(internalBundleUrl('iec', kTier3)));

    // And every bundle key appears in the rendered output.
    expect(html).toContain(kPublic);
    expect(html).toContain(kNoConsent);
    expect(html).toContain(kEmbargoed);
    expect(html).toContain(kTier3);
  });

  it('annotates each row with WHY it is / is not public (visibility-tier badges)', async () => {
    const resolver = mixedTierResolver({ kPublic, kNoConsent, kEmbargoed, kTier3 });
    const view = await buildInternalResultsView(input(), resolver);
    const use = buildInternalUse(view, NOW);
    const indexHtml =
      generateInternalFiles(view, use, NOW).find(
        (f) => f.path === 'internal/results/index.html',
      )?.html ?? '';

    expect(indexHtml).toContain('tier 1 — public'); // the public Tier-1 row
    expect(indexHtml).toContain('no consent'); // Tier-2-no-consent reason
    expect(indexHtml).toContain('case-by-case'); // Tier-3 reason
    expect(indexHtml).toContain('under embargo'); // embargoed Tier-1 reason
    expect(indexHtml).toContain('internal-only');
  });
});

describe('site-internal/ separation (never site/)', () => {
  it('generated paths are all under internal/results/, never results/ (public)', async () => {
    const k = 'sha256:' + '5'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([[k, [resolvedRow({ visibility: { tier: 'tier-2' } })]]]),
    );
    const view = await buildInternalResultsView(
      renderInput([repoState('iec', { bundleKeys: [k] })]),
      resolver,
    );
    const files = generateInternalFiles(view, buildInternalUse(view, NOW), NOW);
    for (const f of files) {
      expect(f.path.startsWith('internal/results/')).toBe(true);
      // Must NOT collide with the PUBLIC `results/...` path space.
      expect(f.path.startsWith('results/')).toBe(false);
    }
  });

  it('writes files under the internalSiteRoot (e.g. site-internal/), not site/', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iep-internal-'));
    try {
      const internalRoot = join(dir, 'site-internal');
      const publicRoot = join(dir, 'site');
      const k = 'sha256:' + '6'.repeat(64);
      const resolver = new FixtureResolver(
        new Map([[k, [resolvedRow({ visibility: { tier: 'tier-3' } })]]]),
      );
      const view = await buildInternalResultsView(
        renderInput([repoState('iec', { bundleKeys: [k] })]),
        resolver,
      );
      const files = generateInternalFiles(view, buildInternalUse(view, NOW), NOW);
      const written = await writeInternalSite(files, internalRoot);

      expect(written.length).toBe(files.length);
      // Everything written lives under site-internal/, nothing under the public
      // site/ origin. Compare against `site/` (with trailing sep) so the
      // `site-internal` prefix does not spuriously match `site`.
      const publicPrefix = publicRoot + sep;
      for (const w of written) {
        expect(w.startsWith(internalRoot + sep)).toBe(true);
        expect(w.startsWith(publicPrefix)).toBe(false);
      }
      // The public site root was never created.
      const entries = await readdir(dir);
      expect(entries).toContain('site-internal');
      expect(entries).not.toContain('site');

      const indexHtml = await readFile(
        join(internalRoot, 'internal/results/index.html'),
        'utf8',
      );
      expect(indexHtml).toContain('<!DOCTYPE html>');
      expect(indexHtml).toContain('Operator-internal results');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('internal index surfaces (4-timestamp + USE view)', () => {
  it('renders the full 4-timestamp surface on the index', async () => {
    const k = 'sha256:' + '7'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([
        [
          k,
          [
            resolvedRow({
              visibility: { tier: 'tier-1' },
              evaluatedAt: '2026-05-30T11:59:00.000Z',
              bundleCreatedAt: '2026-05-30T12:00:00.000Z',
              rekorLogIndices: [424242],
            }),
          ],
        ],
      ]),
    );
    const view = await buildInternalResultsView(
      renderInput([repoState('iec', { bundleKeys: [k], ingestedAt: '2026-05-30T12:00:05.000Z' })]),
      resolver,
    );
    const indexHtml =
      generateInternalFiles(view, buildInternalUse(view, NOW), NOW).find(
        (f) => f.path === 'internal/results/index.html',
      )?.html ?? '';

    // The 4 distinct timestamps + the rekor anchor all render, none collapsed.
    expect(indexHtml).toContain('2026-05-30T11:59:00.000Z'); // evaluated_at
    expect(indexHtml).toContain('2026-05-30T12:00:00.000Z'); // bundle_created_at
    expect(indexHtml).toContain('2026-05-30T12:00:05.000Z'); // ingested_at
    expect(indexHtml).toContain('logIndex=424242'); // rekor anchor
    // The column headers prove the surface is intact.
    expect(indexHtml).toContain('Evaluated at');
    expect(indexHtml).toContain('Bundle created at');
    expect(indexHtml).toContain('Rekor anchor');
    expect(indexHtml).toContain('Ingested at');
  });

  it('renders the USE-method view (Utilization / Saturation / Errors) on the index', async () => {
    const k = 'sha256:' + '8'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([[k, [resolvedRow({ visibility: { tier: 'tier-1' } })]]]),
    );
    const view = await buildInternalResultsView(
      renderInput([repoState('iec', { bundleKeys: [k] })]),
      resolver,
    );
    const indexHtml =
      generateInternalFiles(view, buildInternalUse(view, NOW), NOW).find(
        (f) => f.path === 'internal/results/index.html',
      )?.html ?? '';

    expect(indexHtml).toContain('USE method');
    expect(indexHtml).toContain('Utilization');
    expect(indexHtml).toContain('Saturation');
    expect(indexHtml).toContain('Errors');
  });

  it('renders a loud no-data index when every repo has no verified rows', async () => {
    const resolver = new FixtureResolver(new Map());
    const view = await buildInternalResultsView(
      renderInput([
        repoState('iec', { nullSnapshot: true }),
        repoState('iel', { nullSnapshot: true }),
      ]),
      resolver,
    );
    const files = generateInternalFiles(view, buildInternalUse(view, NOW), NOW);
    const indexHtml =
      files.find((f) => f.path === 'internal/results/index.html')?.html ?? '';
    expect(indexHtml).toContain('no-data');
    // Index page is always emitted.
    expect(files.map((f) => f.path)).toContain('internal/results/index.html');
  });
});

describe('deriveLiveness', () => {
  it('marks a repo fresh iff it has rows and is not stale', async () => {
    const k = 'sha256:' + '9'.repeat(64);
    const resolver = new FixtureResolver(
      new Map([[k, [resolvedRow({ visibility: { tier: 'tier-1' } })]]]),
    );
    const view = await buildInternalResultsView(
      renderInput([
        repoState('iec', { bundleKeys: [k] }), // fresh
        repoState('iel', { bundleKeys: [k], staleSince: '2026-05-29T00:00:00.000Z' }), // stale → not fresh
        repoState('iah', { nullSnapshot: true }), // no rows → not fresh
      ]),
      resolver,
    );
    const live = deriveLiveness(view);
    expect(live.find((l) => l.repo === 'iec')?.fresh).toBe(true);
    expect(live.find((l) => l.repo === 'iel')?.fresh).toBe(false);
    expect(live.find((l) => l.repo === 'iah')?.fresh).toBe(false);
  });
});

describe('C3 cleanliness of internal output', () => {
  it('emits no cross-predicate aggregate PASS%, even across heterogeneous predicates', async () => {
    const kA = 'sha256:' + 'c'.repeat(64);
    const kB = 'sha256:' + 'd'.repeat(64);
    // Two predicate URIs, multiple passes — the exact shape that WOULD trip C3 if
    // the renderer composited a pass-rate across predicates.
    const resolver = new FixtureResolver(
      new Map([
        [
          kA,
          [
            resolvedRow({ predicateUri: GATE_RESULT_URI, decision: 'pass', visibility: { tier: 'tier-2' } }),
            resolvedRow({ predicateUri: GATE_RESULT_URI, decision: 'pass', visibility: { tier: 'tier-1' } }),
          ],
        ],
        [
          kB,
          [
            resolvedRow({ predicateUri: VALIDATION_URI, decision: 'pass', visibility: { tier: 'tier-3' } }),
            resolvedRow({ predicateUri: VALIDATION_URI, decision: 'fail', visibility: { tier: 'tier-1', embargoUntil: FUTURE_EMBARGO } }),
          ],
        ],
      ]),
    );
    const view = await buildInternalResultsView(
      renderInput([repoState('iec', { bundleKeys: [kA, kB] })]),
      resolver,
    );
    const files = generateInternalFiles(view, buildInternalUse(view, NOW), NOW);
    for (const f of files) {
      expect(scanForAggregatePass(f.html)).toEqual([]);
    }
  });
});

describe('pathFromInternalUrl', () => {
  it('maps an internal site URL to a file path', () => {
    expect(pathFromInternalUrl('/internal/results/iec/')).toBe('internal/results/iec/index.html');
    expect(pathFromInternalUrl(internalRepoUrl('iec'))).toBe('internal/results/iec/index.html');
  });
});
