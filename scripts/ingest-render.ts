#!/usr/bin/env node
/**
 * Live ingest → render orchestration (the Phase-2 entrypoint the VPS cron runs).
 *
 * Drives the FULL verify-before-render loop for real:
 *   1. resolve each repo's report-manifest URL (manifest-urls)
 *   2. fetch + VERIFY (OIDC + Rekor + DSSE + kernel schema) + content-address +
 *      snapshot via the security-critical worker (live-pass)
 *   3. persist each verified row's gate-result bodies (gate-row store)
 *   4. render the public results browser + freshness/status strip + the gated
 *      internal testing dashboard from the VERIFIED snapshots
 *
 * A repo that fails verification fail-closes (no-data / prior snapshot) — never a
 * synthetic pass. Stores are filesystem-backed under `--root` (default
 * `.ingest-store`, NOT the prod `/var/lib` path). The deploy hop (rsync + Caddy
 * reload to labs.intentsolutions.io) stays the human-gated VPS step — this script
 * only ingests + renders into `site/` + `site-internal/`.
 *
 * Usage (after `pnpm run build`):
 *   node --experimental-strip-types scripts/ingest-render.ts [--supervised] [--root DIR] [--site site] [--internal site-internal]
 */

import { fileURLToPath } from 'node:url';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { requireCommittedInputs, verifyBuildProvenance } from './build-provenance.mjs';

const INGEST_REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp', 'jrig', 'qmd'];

function arg(argv, flag, dflt) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}

async function main(argv) {
  const scriptRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  if (realpathSync(process.cwd()) !== scriptRoot) {
    throw new Error('collector cwd must match the entry script checkout');
  }
  requireCommittedInputs(process.cwd());
  const { inputDigest, distDigest } = verifyBuildProvenance(process.cwd());
  const { HttpManifestFetcher } = await import('../dist/ingest/fetcher-http.js');
  const { makeManifestUrlResolver } = await import('../dist/ingest/manifest-urls.js');
  const { parsePinnedSubjects } = await import('../dist/ingest/pinned-loader.js');
  const { SigstoreRowVerifier } = await import('../dist/ingest/verifier-sigstore.js');
  const { FsContentStore, FsSnapshotStore, systemIngestClock } =
    await import('../dist/ingest/storage-fs.js');
  const { FsGateRowStore } = await import('../dist/ingest/gate-row-store.js');
  const { runLivePass } = await import('../dist/ingest/live-pass.js');
  const { restartPressure } = await import('../dist/freshness/restart-pressure.js');
  const { ContentStoreBundleResolver } = await import('../dist/results/bundle-resolver.js');
  const { StoreGateRowSource } = await import('../dist/results/store-gate-row-source.js');
  const { buildPublicResultsView, generateResultsFiles } =
    await import('../dist/results/generate.js');
  const { StoreTestingResolver } =
    await import('../dist/internal-testing/store-testing-resolver.js');
  const { buildTestingView } = await import('../dist/internal-testing/testing-row.js');
  const { generateTestingFiles } = await import('../dist/internal-testing/generate-testing.js');
  const { loadExplainers } = await import('../dist/internal-testing/explainers.js');
  const { buildFreshness, generateFreshnessFiles } = await import('../dist/freshness/generate.js');
  const { buildInternalResultsView, buildInternalUse, generateInternalFiles } =
    await import('../dist/results/generate-internal.js');
  const {
    publicVerificationGeneration,
    generationSelector,
    generationStoreRoot,
    hasCurrentArtifactGeneration,
    newlyVerifiedRepoCount,
  } = await import('../dist/ingest/verification-generation.js');
  const { prepareGenerationCandidate, applyGenerationCandidate } =
    await import('../dist/ingest/generation-routes.js');
  const storeBase = resolve(process.cwd(), arg(argv, '--root', '.ingest-store'));
  const siteRoot = resolve(process.cwd(), arg(argv, '--site', 'site'));
  const internalRoot = resolve(process.cwd(), arg(argv, '--internal', 'site-internal'));
  const nowIso = new Date().toISOString();

  const pinned = parsePinnedSubjects(
    JSON.parse(readFileSync(resolve(process.cwd(), 'ingest/pinned-subjects.json'), 'utf8')),
  );

  const generation = publicVerificationGeneration(pinned);
  if (argv.includes('--print-generation')) {
    console.log(generationSelector(generation));
    return 0;
  }
  const root = generationStoreRoot(storeBase, generation);
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  // Private checkout metadata is outside published output and git add -A.
  const gitDir = resolve(
    execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim(),
  );
  const privateRoot = join(gitDir, 'task-receipts', 'generation-candidates');
  for (const flag of ['--prepare-trust-migration', '--apply-prepared-generation']) {
    if (
      argv.includes(flag) &&
      (!argv[argv.indexOf(flag) + 1] || argv[argv.indexOf(flag) + 1].startsWith('--'))
    ) {
      throw new Error(`${flag} requires a directory`);
    }
  }
  const prepare = arg(argv, '--prepare-trust-migration', null);
  const apply = arg(argv, '--apply-prepared-generation', null);
  if (prepare && apply) throw new Error('prepare and apply modes are mutually exclusive');
  if (apply) {
    await mkdir(privateRoot, { recursive: true, mode: 0o700 });
    const parent = await mkdtemp(join(privateRoot, 'apply-'));
    await applyGenerationCandidate({
      candidate: resolve(apply),
      backup: join(parent, 'backup'),
      publicRoot: siteRoot,
      internalRoot,
      generation,
      sourceRevision,
      inputDigest,
      distDigest,
      allowEmpty: argv.includes('--allow-empty-trust-migration'),
    });
    console.log(
      'Prepared generation applied to checkout only; deployed activation is NOT verified.',
    );
    return 0;
  }
  if (
    !prepare &&
    (!(await hasCurrentArtifactGeneration(siteRoot, generation)) ||
      !(await hasCurrentArtifactGeneration(internalRoot, generation)))
  ) {
    throw new Error(
      'MIGRATION_REQUIRED: prepare and review a generation candidate; legacy routes and stores are not current trust evidence',
    );
  }

  // Loud-on-startup: any pinned subject still `operatorConfirmed: false` has an
  // unverified OIDC workflowRef (placeholder ref, not yet checked against the
  // repo's actual .github/workflows/). Surface it every pass so an unconfirmed
  // pin can never silently sit in the production allowlist (DR-035 B1).
  for (const [repo, entry] of Object.entries(pinned.repos)) {
    if (!entry.operatorConfirmed) {
      console.warn(
        `⚠ pinned subject for "${repo}" (${entry.githubRepo}) is operatorConfirmed:false — its OIDC workflowRef is an UNVERIFIED placeholder; confirm against the repo's .github/workflows/ and flip to true`,
      );
    }
  }

  const contentStore = new FsContentStore(root);
  const snapshotStore = new FsSnapshotStore(root);
  const gateRowStore = new FsGateRowStore(root);

  const deps = {
    fetcher: new HttpManifestFetcher(makeManifestUrlResolver(pinned), 10000),
    verifier: new SigstoreRowVerifier(1),
    contentStore,
    snapshotStore,
    gateRowStore,
    clock: systemIngestClock,
    pinned,
  };

  console.log('── ingest pass (fetch → verify → content-address → snapshot) ──');
  const { input, outcomes, supervision } = await runLivePass(deps, INGEST_REPOS, {
    supervised: argv.includes('--supervised'),
  });
  for (const o of outcomes) {
    console.log(
      `  ${o.repo}: ${o.fresh ? 'VERIFIED ✓' : `no-data (${o.failure?.step ?? 'unreachable'}/${o.failure?.reasonCode ?? '—'})`}`,
    );
  }

  // --- render: public results ---
  const publicResolver = new ContentStoreBundleResolver(
    contentStore,
    new StoreGateRowSource(gateRowStore),
  );
  const resultsView = await buildPublicResultsView(input, publicResolver, nowIso);
  const publicFiles = generateResultsFiles(resultsView);

  // --- render: gated internal testing dashboard ---
  const testingResolver = new StoreTestingResolver(contentStore, gateRowStore);
  const explainers = await loadExplainers(resolve(process.cwd(), 'content/explainers'));
  const testingView = await buildTestingView(input, testingResolver);
  const internalView = await buildInternalResultsView(input, publicResolver);
  const internalFiles = [
    ...generateTestingFiles(testingView, explainers),
    ...generateInternalFiles(internalView, buildInternalUse(internalView, nowIso), nowIso),
  ];

  // --- render: public freshness / status strip (the labs strip) ---
  const rows = testingView.repos.flatMap((r) =>
    r.rows.map((row) => ({ repo: row.repo, evaluatedAt: row.evaluatedAt, decision: row.decision })),
  );
  // Carry staleSince + failure through so computeIngestUse can report real S
  // (stale repos) + E (crashes) during a partial-failure cron — not 0/0. The
  // outcome objects carry `repo`/`fresh`/`failure`; the stale timestamp lives on
  // the render input (`input.repos[].staleSince`, stamped by buildRenderInput
  // when a worker crashed and we kept its prior-good snapshot), so we join it in.
  const staleSinceByRepo = new Map(input.repos.map((r) => [r.repo, r.staleSince]));
  const liveness = outcomes.map((o) => ({
    repo: o.repo,
    fresh: o.fresh,
    staleSince: staleSinceByRepo.get(o.repo),
    failure: o.failure,
  }));
  publicFiles.push(
    ...generateFreshnessFiles(
      buildFreshness({
        repos: INGEST_REPOS,
        rows,
        liveness,
        pressure: restartPressure(supervision, INGEST_REPOS.length),
        nowIso,
      }),
      readFileSync(join(siteRoot, 'index.html'), 'utf8'),
    ),
  );

  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(join(privateRoot, 'render-'));
  const candidate = prepare ? resolve(prepare) : join(parent, 'candidate');
  const verifiedRepos = newlyVerifiedRepoCount(input, outcomes);
  await prepareGenerationCandidate({
    candidate,
    publicRoot: siteRoot,
    internalRoot,
    generation,
    sourceRevision,
    inputDigest,
    distDigest,
    verifiedRepos,
    files: [
      ...publicFiles.map((file) => ({ ...file, root: 'public' })),
      ...internalFiles.map((file) => ({ ...file, root: 'internal' })),
    ],
  });
  if (prepare) {
    console.log(
      `Generation candidate prepared; ${verifiedRepos} repos supplied newly verified rows. No served routes changed or deployed activation established.`,
    );
    return 0;
  }
  await applyGenerationCandidate({
    candidate,
    backup: join(parent, 'backup'),
    publicRoot: siteRoot,
    internalRoot,
    generation,
    sourceRevision,
    inputDigest,
    distDigest,
    allowEmpty: true,
  });

  // --- report what rendered ---
  for (const repo of testingView.repos) {
    if (!repo.noData) {
      const decisions = repo.rows.map((r) => `${r.gateName}=${r.decision}`).join(', ');
      console.log(`── rendered ${repo.repo}: ${decisions}`);
    }
  }
  console.log(
    '✓ ingest-render complete (site/ + site-internal/ written; deploy is the human-gated VPS step)',
  );
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('ingest-render crashed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
