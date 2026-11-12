import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsContentStore, FsSnapshotStore, systemIngestClock } from '../ingest/storage-fs.js';
import { FsGateRowStore } from '../ingest/gate-row-store.js';
import { runLivePass } from '../ingest/live-pass.js';
import type { IngestClock, SigstoreVerifier } from '../ingest/interfaces.js';
import { StoreTestingResolver } from '../internal-testing/store-testing-resolver.js';
import { buildTestingView } from '../internal-testing/testing-row.js';
import { generateTestingFiles, writeTestingSite } from '../internal-testing/generate-testing.js';
import { loadExplainers } from '../internal-testing/explainers.js';
import { parsePrivateConfig, privatePins } from './config.js';
import {
  FileCredentials,
  readPrivateFile,
  validatePrivatePaths,
  assertPrivateTree,
  type PrivatePaths,
} from './paths.js';
import { PrivateGithubFetcher, type PrivateHttp } from './github.js';
import { privateGeneration } from './generation.js';
import { PrivateRowVerifier } from './verifier.js';
import { PrivateIngestError, safeReason, type PrivateReason } from './reason.js';

const checkout = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export interface PrivateRunOptions {
  readonly paths: PrivatePaths;
  readonly publicRoots?: readonly string[];
  /** Test seams only; CLI never accepts verifier, HTTP or clock configuration. */
  readonly http?: PrivateHttp;
  readonly verifier?: SigstoreVerifier;
  readonly clock?: IngestClock;
}
export interface PrivateRunResult {
  readonly generation: string;
  readonly sources: number;
  readonly verified: number;
  readonly failed: number;
}

/** No public renderer, freshness generator, cache, Git or deployment dependency. */
export async function runPrivateCollection(options: PrivateRunOptions): Promise<PrivateRunResult> {
  const oldMask = process.umask(0o077);
  try {
    const paths = await validatePrivatePaths(options.paths, [
      checkout,
      ...(options.publicRoots ?? []),
    ]);
    let config;
    try {
      config = parsePrivateConfig(JSON.parse(await readPrivateFile(paths.config, 128 * 1024)));
    } catch {
      throw new PrivateIngestError('configuration_invalid');
    }
    const generation = privateGeneration(config);
    const stateRoot = join(paths.state, generation);
    const outputRoot = join(paths.output, generation);
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    const contentStore = new FsContentStore(stateRoot);
    const snapshotStore = new FsSnapshotStore(stateRoot);
    const gateRowStore = new FsGateRowStore(stateRoot);
    const fetcher = new PrivateGithubFetcher(
      config,
      new FileCredentials(paths.credentials, config),
      options.http,
    );
    const result = await runLivePass(
      {
        fetcher,
        contentStore,
        snapshotStore,
        gateRowStore,
        verifier: options.verifier ?? new PrivateRowVerifier(),
        clock: options.clock ?? systemIngestClock,
        pinned: privatePins(config),
      },
      config.sources.map((s) => s.key),
    );
    // The shared worker returns only finite reason codes (not raw failure detail).
    const view = await buildTestingView(
      result.input,
      new StoreTestingResolver(contentStore, gateRowStore),
    );
    const explainers = await loadExplainers(join(checkout, 'content/explainers'));
    await assertPrivateTree(paths.privateRoot);
    await writeTestingSite(generateTestingFiles(view, explainers), outputRoot);
    // Shared authored public CSS is read-only input, never private data output.
    await writeFile(
      join(outputRoot, 'style.css'),
      await readFile(join(checkout, 'site/style.css')),
      { mode: 0o600 },
    );
    await assertPrivateTree(paths.privateRoot);
    const verified = result.outcomes.filter((o) => o.fresh).length;
    return {
      generation,
      sources: result.outcomes.length,
      verified,
      failed: result.outcomes.length - verified,
    };
  } catch (error) {
    throw new PrivateIngestError(safeReason(error));
  } finally {
    process.umask(oldMask);
  }
}

export interface PrivateCliOutcome {
  readonly exitCode: number;
  readonly report: PrivateRunResult | { readonly error: PrivateReason };
}
export async function privateCli(
  argv: readonly string[],
  run = runPrivateCollection,
): Promise<PrivateCliOutcome> {
  try {
    const flags = ['--private-root', '--config', '--credentials', '--state', '--output'] as const;
    const values = new Map<string, string>();
    for (let i = 0; i < argv.length; i += 2) {
      const flag = argv[i];
      const value = argv[i + 1];
      if (
        !flag ||
        !flags.some((f) => f === flag) ||
        !value ||
        value.startsWith('--') ||
        values.has(flag)
      ) {
        throw new PrivateIngestError('configuration_invalid');
      }
      values.set(flag, value);
    }
    if (values.size !== flags.length) throw new PrivateIngestError('configuration_invalid');
    const report = await run({
      paths: {
        privateRoot: values.get('--private-root')!,
        config: values.get('--config')!,
        credentials: values.get('--credentials')!,
        state: values.get('--state')!,
        output: values.get('--output')!,
      },
    });
    return { exitCode: report.failed > 0 ? 1 : 0, report };
  } catch (error) {
    return { exitCode: 1, report: { error: safeReason(error) } };
  }
}
