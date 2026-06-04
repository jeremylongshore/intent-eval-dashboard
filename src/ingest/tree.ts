/**
 * The deploy supervision tree assembly (DR-035 § 4.B / Epic 2.2).
 *
 *   deploy_supervisor          one_for_one, restart=permanent
 *   ├── ingest_supervisor      one_for_one, max_restarts=N per repo per hour
 *   │   ├── ingest_worker:iec  transient
 *   │   ├── ingest_worker:iel  transient
 *   │   ├── ingest_worker:iah  transient
 *   │   ├── ingest_worker:iaj  transient
 *   │   ├── ingest_worker:iar  transient
 *   │   └── ingest_worker:ccp  transient
 *   ├── renderer               rest_for_one (downstream of ingest snapshot)
 *   └── publisher (rsync+caddy) rest_for_one (downstream of renderer)
 *
 * ICOS is STRUCK from the tree (cross-tier policy). 6 workers exactly.
 *
 * This module builds the SUPERVISOR SPECS with the correct strategies +
 * restart types, and provides a deploy-pass orchestrator that:
 *   1. runs the ingest_supervisor (6 transient workers, one_for_one isolation);
 *   2. records which repos produced fresh snapshots vs crashed;
 *   3. feeds the per-repo outcomes to the renderer (which serves prior-good
 *      snapshots for crashed repos with a stale badge);
 *   4. invokes the publisher.
 *
 * The renderer/publisher are downstream of the ingest snapshot but are NOT
 * restarted by a single worker's transient crash — a crashed transient worker
 * is restarted in isolation (one_for_one) and the renderer simply serves the
 * prior snapshot for that repo. rest_for_one applies to the deploy_supervisor's
 * own children (ingest_supervisor, renderer, publisher) — e.g. if the renderer
 * node itself fails, renderer + publisher restart; if the publisher fails, only
 * the publisher restarts.
 */

import { type RestartBudget, type SupervisorSpec } from '../supervision/index.js';
import { isIngestCrash, type IngestReason } from './reason.js';
import { type Publisher } from './publisher.js';
import { type Renderer, type RepoPassOutcome } from './renderer.js';
import { runIngestWorker, type IngestWorkerDeps } from './worker.js';

/** The 6 ingest repos. ICOS struck per cross-tier policy. */
export const INGEST_REPOS = ['iec', 'iel', 'iah', 'iaj', 'iar', 'ccp'] as const;
export type IngestRepo = (typeof INGEST_REPOS)[number];

/** Default per-repo restart budget: N restarts per hour (OTP intensity/period). */
export const DEFAULT_INGEST_BUDGET: RestartBudget = {
  maxRestarts: 3,
  periodMs: 60 * 60 * 1000, // 1 hour
};

/**
 * Build the `ingest_supervisor` spec: 6 transient workers, one_for_one.
 *
 * `runWorker` is the (injected) per-repo ingest pass. Each child wraps it so a
 * crash surfaces as an abnormal exit carrying the structured reason; a clean
 * pass is a normal exit (transient → not restarted on success).
 */
export function buildIngestSupervisorSpec(
  runWorker: (repo: string) => Promise<unknown>,
  repos: readonly string[] = INGEST_REPOS,
  budget: RestartBudget = DEFAULT_INGEST_BUDGET,
): SupervisorSpec {
  return {
    id: 'ingest_supervisor',
    strategy: 'one_for_one',
    budget,
    children: repos.map((repo) => ({
      id: `ingest_worker:${repo}`,
      restart: 'transient' as const,
      start: async () => {
        await runWorker(repo);
        return { kind: 'normal' as const };
      },
    })),
  };
}

/**
 * Build the `deploy_supervisor` spec.
 *
 * Children in START ORDER (load-bearing for rest_for_one):
 *   1. ingest_supervisor (permanent — the ingest layer must always be up)
 *   2. renderer          (permanent — restarting renderer also restarts publisher)
 *   3. publisher         (permanent — restarting publisher restarts only itself)
 *
 * Strategy is rest_for_one: a renderer failure cascades to the publisher; a
 * publisher failure is isolated. The ingest_supervisor's OWN children use
 * one_for_one (see buildIngestSupervisorSpec) — the two strategies coexist at
 * different levels of the tree, exactly as in OTP.
 */
export function buildDeploySupervisorSpec(nodes: {
  readonly ingestSupervisor: () => Promise<unknown>;
  readonly renderer: () => Promise<unknown>;
  readonly publisher: () => Promise<unknown>;
  readonly budget?: RestartBudget;
}): SupervisorSpec {
  const budget = nodes.budget ?? { maxRestarts: 5, periodMs: 60 * 60 * 1000 };
  return {
    id: 'deploy_supervisor',
    strategy: 'rest_for_one',
    budget,
    children: [
      {
        id: 'ingest_supervisor',
        restart: 'permanent',
        start: async () => {
          await nodes.ingestSupervisor();
          return { kind: 'normal' as const };
        },
      },
      {
        id: 'renderer',
        restart: 'permanent',
        start: async () => {
          await nodes.renderer();
          return { kind: 'normal' as const };
        },
      },
      {
        id: 'publisher',
        restart: 'permanent',
        start: async () => {
          await nodes.publisher();
          return { kind: 'normal' as const };
        },
      },
    ],
  };
}

/** Outcome of running one full deploy pass. */
export interface DeployPassResult {
  /** Per-repo ingest outcome (fresh snapshot vs crashed + structured reason). */
  readonly ingest: readonly RepoPassOutcome[];
  /** The render input the renderer produced. */
  readonly rendered: Awaited<ReturnType<Renderer['render']>>;
  /** The publish result (no-op by default). */
  readonly published: Awaited<ReturnType<Publisher['publish']>>;
}

/**
 * Run one full deploy pass: ingest all repos in isolation (a crash in one does
 * NOT affect the others — one_for_one semantics realized concurrently), then
 * render (serving prior-good snapshots for crashed repos), then publish.
 *
 * Returns the structured outcome for assertions. A crashed worker's structured
 * {@link IngestReason} is preserved in its outcome's `failure` summary.
 */
export async function runDeployPass(
  deps: IngestWorkerDeps,
  renderer: Renderer,
  publisher: Publisher,
  outputDir: string,
  repos: readonly string[] = INGEST_REPOS,
): Promise<DeployPassResult> {
  // Ingest each repo independently. Settle ALL — one repo's crash must not
  // short-circuit the others (one_for_one isolation).
  const settled = await Promise.allSettled(
    repos.map((repo) => runIngestWorker(repo, deps)),
  );

  const outcomes: RepoPassOutcome[] = repos.map((repo, i) => {
    const result = settled[i];
    /* v8 ignore next 3 -- defensive: allSettled returns one entry per repo. */
    if (result === undefined) {
      return { repo, fresh: false };
    }
    if (result.status === 'fulfilled') {
      return { repo, fresh: true };
    }
    const err: unknown = result.reason;
    if (isIngestCrash(err)) {
      const reason: IngestReason = err.reason;
      return {
        repo,
        fresh: false,
        failure: { step: reason.step, reasonCode: reason.reasonCode },
      };
    }
    /* v8 ignore next 5 -- defensive: runIngestWorker always wraps failures in
       IngestCrash; this guards the impossible case of a raw throw escaping it. */
    return {
      repo,
      fresh: false,
      failure: { step: 'unknown', reasonCode: 'unknown' },
    };
  });

  const nowIso = deps.clock.nowIso();
  const rendered = await renderer.render(outcomes, nowIso);
  const published = await publisher.publish({ renderInput: rendered, outputDir });

  return { ingest: outcomes, rendered, published };
}
