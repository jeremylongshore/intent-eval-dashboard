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
 *   node --experimental-strip-types scripts/ingest-render.ts [--root DIR] [--site site] [--internal site-internal]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpManifestFetcher } from '../dist/ingest/fetcher-http.js';
import { makeManifestUrlResolver } from '../dist/ingest/manifest-urls.js';
import { parsePinnedSubjects } from '../dist/ingest/pinned-loader.js';
import { SigstoreRowVerifier } from '../dist/ingest/verifier-sigstore.js';
import { FsContentStore, FsSnapshotStore, systemIngestClock } from '../dist/ingest/storage-fs.js';
import { FsGateRowStore } from '../dist/ingest/gate-row-store.js';
import { runLivePass } from '../dist/ingest/live-pass.js';
import { ContentStoreBundleResolver } from '../dist/results/bundle-resolver.js';
import { StoreGateRowSource } from '../dist/results/store-gate-row-source.js';
import { buildPublicResultsView, generateResultsFiles, writeResultsSite } from '../dist/results/generate.js';
import { StoreTestingResolver } from '../dist/internal-testing/store-testing-resolver.js';
import { buildTestingView } from '../dist/internal-testing/testing-row.js';
import {
  generateTestingFiles,
  writeTestingSite,
} from '../dist/internal-testing/generate-testing.js';
import { loadExplainers } from '../dist/internal-testing/explainers.js';
import { generateAndWrite as generateStatus } from '../dist/freshness/generate.js';

const INGEST_REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'];

function arg(argv, flag, dflt) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}

async function main(argv) {
  const root = resolve(process.cwd(), arg(argv, '--root', '.ingest-store'));
  const siteRoot = resolve(process.cwd(), arg(argv, '--site', 'site'));
  const internalRoot = resolve(process.cwd(), arg(argv, '--internal', 'site-internal'));
  const nowIso = new Date().toISOString();

  const pinned = parsePinnedSubjects(JSON.parse(readFileSync(resolve(process.cwd(), 'ingest/pinned-subjects.json'), 'utf8')));

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
  const { input, outcomes } = await runLivePass(deps, INGEST_REPOS);
  for (const o of outcomes) {
    console.log(`  ${o.repo}: ${o.fresh ? 'VERIFIED ✓' : `no-data (${o.failure?.step ?? 'unreachable'}/${o.failure?.reasonCode ?? '—'})`}`);
  }

  // --- render: public results ---
  const publicResolver = new ContentStoreBundleResolver(contentStore, new StoreGateRowSource(gateRowStore));
  const resultsView = await buildPublicResultsView(input, publicResolver, nowIso);
  await writeResultsSite(generateResultsFiles(resultsView), siteRoot);

  // --- render: gated internal testing dashboard ---
  const testingResolver = new StoreTestingResolver(contentStore, gateRowStore);
  const explainers = await loadExplainers(resolve(process.cwd(), 'content/explainers'));
  const testingView = await buildTestingView(input, testingResolver);
  await writeTestingSite(generateTestingFiles(testingView, explainers), internalRoot);

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
  await generateStatus(
    {
      repos: INGEST_REPOS,
      rows,
      liveness,
      pressure: { restartCount: 0, restartBudget: 3 * INGEST_REPOS.length, escalatedChildIds: [] },
      nowIso,
    },
    siteRoot,
  );

  // --- report what rendered ---
  for (const repo of testingView.repos) {
    if (!repo.noData) {
      const decisions = repo.rows.map((r) => `${r.gateName}=${r.decision}`).join(', ');
      console.log(`── rendered ${repo.repo}: ${decisions}`);
    }
  }
  console.log('✓ ingest-render complete (site/ + site-internal/ written; deploy is the human-gated VPS step)');
  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('ingest-render crashed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
