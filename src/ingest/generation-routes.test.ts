import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  prepareGenerationCandidate,
  applyGenerationCandidate,
  ownsGeneratedRoute,
  type RouteFile,
} from './generation-routes.js';
import {
  publicVerificationGeneration,
  hasCurrentArtifactGeneration,
} from './verification-generation.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const generation = publicVerificationGeneration({ issuer: 'fixture', repos: {} });
const sourceRevision = 'a'.repeat(40);
const oldRoute = `results/iec/sha256-${'b'.repeat(64)}/index.html`;
const files: RouteFile[] = [
  ...['index.html', 'results/index.html', 'evals/index.html', 'status/index.html'].map((path) => ({
    root: 'public' as const,
    path,
    html: 'current public',
  })),
  ...['internal/results/index.html', 'internal/testing/index.html'].map((path) => ({
    root: 'internal' as const,
    path,
    html: 'operator only',
  })),
];
let sandbox: string;
let options: {
  candidate: string;
  backup: string;
  publicRoot: string;
  internalRoot: string;
  generation: typeof generation;
  sourceRevision: string;
  inputDigest: string;
  distDigest: string;
  allowEmpty: boolean;
};
beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'generation-routes-'));
  options = {
    candidate: join(sandbox, 'candidate'),
    backup: join(sandbox, 'backup'),
    publicRoot: join(sandbox, 'public'),
    internalRoot: join(sandbox, 'operator'),
    generation,
    sourceRevision,
    inputDigest: 'd'.repeat(64),
    distDigest: 'e'.repeat(64),
    allowEmpty: false,
  };
  await mkdir(join(options.publicRoot, oldRoute, '..'), { recursive: true });
  await writeFile(join(options.publicRoot, oldRoute), 'old trust');
  await writeFile(join(options.publicRoot, 'index.html'), 'authored landing');
  await mkdir(join(options.publicRoot, 'retracted'), { recursive: true });
  await writeFile(join(options.publicRoot, 'retracted', 'keep.html'), 'tombstone');
  await mkdir(join(sandbox, 'deploy'));
  await writeFile(
    join(sandbox, 'deploy/retractions.snippet'),
    `handle /${oldRoute.replace('/index.html', '/')} {\n  respond 410\n}\n`,
  );
  await writeFile(join(options.publicRoot, 'results', 'authored.html'), 'authored');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(sandbox, { recursive: true, force: true });
});
async function prepare(verifiedRepos = 1): Promise<void> {
  await prepareGenerationCandidate({ ...options, verifiedRepos, files });
}
describe('generation candidate application', () => {
  it('prepares without mutation then replaces exact owned routes while preserving authored/retracted files', async () => {
    const retraction = await readFile(join(sandbox, 'deploy/retractions.snippet'));
    await prepare();
    expect(await readFile(join(options.publicRoot, oldRoute), 'utf8')).toBe('old trust');
    expect(await hasCurrentArtifactGeneration(options.publicRoot, generation)).toBe(false);
    await applyGenerationCandidate(options);
    await expect(readFile(join(options.publicRoot, oldRoute))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(join(options.backup, 'public', oldRoute), 'utf8')).toBe('old trust');
    expect(await readFile(join(options.publicRoot, 'results/authored.html'), 'utf8')).toBe(
      'authored',
    );
    expect(await readFile(join(options.publicRoot, 'retracted/keep.html'), 'utf8')).toBe(
      'tombstone',
    );
    expect(await readFile(join(sandbox, 'deploy/retractions.snippet'))).toEqual(retraction);
    expect(retraction.toString()).toContain('respond 410');
    expect(await hasCurrentArtifactGeneration(options.publicRoot, generation)).toBe(true);
    expect(await hasCurrentArtifactGeneration(options.internalRoot, generation)).toBe(true);
  });
  it('rejects a different valid build identity before any destination write', async () => {
    await prepare();
    await expect(
      applyGenerationCandidate({ ...options, distDigest: 'f'.repeat(64) }),
    ).rejects.toThrow('compiled build identity');
    await expect(
      applyGenerationCandidate({ ...options, inputDigest: 'f'.repeat(64) }),
    ).rejects.toThrow('compiled build identity');
    expect(await readFile(join(options.publicRoot, oldRoute), 'utf8')).toBe('old trust');
    expect(await hasCurrentArtifactGeneration(options.publicRoot, generation)).toBe(false);
  });
  it('refuses zero verified evidence until explicit empty-artifact acknowledgement', async () => {
    await prepare(0);
    await expect(applyGenerationCandidate(options)).rejects.toThrow('zero-verified-evidence');
    expect(await readFile(join(options.publicRoot, oldRoute), 'utf8')).toBe('old trust');
    await applyGenerationCandidate({ ...options, allowEmpty: true });
    expect(await hasCurrentArtifactGeneration(options.publicRoot, generation)).toBe(true);
  });
  it('refuses changed destination, candidate bytes and source before modifying output', async () => {
    await prepare();
    await expect(
      applyGenerationCandidate({ ...options, sourceRevision: 'b'.repeat(40) }),
    ).rejects.toThrow('generation/source');
    await writeFile(join(options.candidate, 'public/index.html'), 'tampered');
    await expect(applyGenerationCandidate(options)).rejects.toThrow('digest');
    await writeFile(join(options.publicRoot, oldRoute), 'changed');
    await expect(applyGenerationCandidate(options)).rejects.toThrow('changed since');
  });
  it('refuses symlink candidate reads and never adopts unknown routes', async () => {
    await prepare();
    await rm(join(options.candidate, 'public/index.html'));
    await symlink(
      join(options.publicRoot, 'index.html'),
      join(options.candidate, 'public/index.html'),
    );
    await expect(applyGenerationCandidate(options)).rejects.toThrow('symlink');
    expect(ownsGeneratedRoute('public', 'results/iec/index.html\n')).toBe(false);
    expect(ownsGeneratedRoute('public', 'results/other/index.html')).toBe(false);
    expect(ownsGeneratedRoute('public', 'retracted/keep.html')).toBe(false);
  });
  it('refuses special-file receipts before any route write', async () => {
    await prepare();
    await rm(join(options.candidate, 'candidate.json'));
    execFileSync('mkfifo', [join(options.candidate, 'candidate.json')]);
    await expect(applyGenerationCandidate(options)).rejects.toThrow('regular file');
    expect(await readFile(join(options.publicRoot, oldRoute), 'utf8')).toBe('old trust');
  });
  it('leaves both generation markers invalid if a route write fails after admission', async () => {
    await prepare();
    const { writeFile: original } = await vi.importActual<typeof fs>('node:fs/promises');
    vi.mocked(fs.writeFile).mockImplementation(async (path, data, opts) => {
      if (typeof path === 'string' && path === join(options.publicRoot, 'results/index.html'))
        throw new Error('disk write failed');
      return original(path, data, opts);
    });
    await expect(applyGenerationCandidate(options)).rejects.toThrow('disk write failed');
    expect(await hasCurrentArtifactGeneration(options.publicRoot, generation)).toBe(false);
    expect(await hasCurrentArtifactGeneration(options.internalRoot, generation)).toBe(false);
    expect(await readFile(join(options.backup, 'public', oldRoute), 'utf8')).toBe('old trust');
  });
});
