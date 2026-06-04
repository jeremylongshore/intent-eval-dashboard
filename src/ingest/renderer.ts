/**
 * Renderer supervision node (rest_for_one, downstream of ingest).
 *
 * The renderer consumes the LATEST VERIFIED snapshot per repo and produces the
 * render input. It is the enforcement point for the verify-before-render
 * binding from the consumption side:
 *
 *   - It reads ONLY from the {@link SnapshotStore} (verified snapshots written
 *     by step 7) — never from a raw manifest. There is no code path that lets an
 *     unverified manifest reach the renderer.
 *   - When a repo has no fresh snapshot this pass (its worker crashed), the
 *     renderer keeps the PRIOR good snapshot and stamps `staleSince` for that
 *     repo so the rendered output can show a visible stale badge (Gregg +
 *     Armstrong binding) — it NEVER renders the unverified input.
 *
 * The actual HTML production is an injected {@link RenderSink} so the
 * supervision wiring is testable without a real templating engine.
 */

import { type IngestSnapshot, type SnapshotStore } from './interfaces.js';

/** One repo's row in the render input. */
export interface RenderRepoState {
  readonly repo: string;
  /** The verified snapshot being rendered (prior-good if this pass crashed). */
  readonly snapshot: IngestSnapshot | null;
  /**
   * Set when the snapshot is NOT from this pass (the worker crashed and we are
   * serving the prior good snapshot). ISO timestamp the staleness began.
   */
  readonly staleSince?: string;
  /** Structured failure summary when this repo's worker crashed this pass. */
  readonly lastFailure?: { readonly step: string; readonly reasonCode: string };
}

/** Render input across all repos. */
export interface RenderInput {
  readonly asOf: string;
  readonly repos: readonly RenderRepoState[];
}

/** Where the rendered output goes (injected; default no-ops with logging). */
export interface RenderSink {
  render(input: RenderInput): Promise<void>;
}

/** Per-repo outcome of an ingest pass, as the renderer sees it. */
export interface RepoPassOutcome {
  readonly repo: string;
  /** True if this repo's worker emitted a fresh snapshot this pass. */
  readonly fresh: boolean;
  /** Structured failure (when !fresh because the worker crashed). */
  readonly failure?: { readonly step: string; readonly reasonCode: string };
}

/**
 * Build the render input from the snapshot store + this pass's outcomes.
 *
 * For each repo:
 *   - fresh   → render its current snapshot, no stale badge.
 *   - crashed → render the PRIOR snapshot (whatever is in the store, which is
 *               last-known-good because step 7 only writes verified snapshots),
 *               stamped with `staleSince` + the failure summary.
 */
export async function buildRenderInput(
  snapshotStore: SnapshotStore,
  outcomes: readonly RepoPassOutcome[],
  nowIso: string,
): Promise<RenderInput> {
  const repos: RenderRepoState[] = [];
  for (const outcome of outcomes) {
    const snapshot = await snapshotStore.get(outcome.repo);
    if (outcome.fresh) {
      repos.push({ repo: outcome.repo, snapshot });
    } else {
      // Worker crashed: keep the prior good snapshot + mark stale.
      repos.push({
        repo: outcome.repo,
        snapshot,
        staleSince: snapshot?.lastKnownGoodIngestedAt ?? nowIso,
        ...(outcome.failure ? { lastFailure: outcome.failure } : {}),
      });
    }
  }
  return { asOf: nowIso, repos };
}

/** A renderer node bound to a snapshot store + render sink. */
export class Renderer {
  constructor(
    private readonly snapshotStore: SnapshotStore,
    private readonly sink: RenderSink,
  ) {}

  /** Render the current state given this pass's per-repo outcomes. */
  async render(outcomes: readonly RepoPassOutcome[], nowIso: string): Promise<RenderInput> {
    const input = await buildRenderInput(this.snapshotStore, outcomes, nowIso);
    await this.sink.render(input);
    return input;
  }
}
