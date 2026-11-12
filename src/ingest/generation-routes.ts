/** Exact owned-route reconciliation. Backups and candidates never live in served roots. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { z } from 'zod';
import { assertOperatorInternalRoot } from '../lib/operator-internal-root.js';
import {
  GENERATION_MARKER,
  artifactMarker,
  generationSelector,
  type VerificationGeneration,
} from './verification-generation.js';

const REPOS = '(?:iec|iel|iah|iaj|iar|ccp|jrig|qmd)';
const resultRoute = new RegExp(
  `^results/(?:index\\.html|${REPOS}/(?:index\\.html|sha256-[a-f0-9]{64}/index\\.html))(?![\\s\\S])`,
);
const testingRoute = new RegExp(
  `^internal/testing/(?:index\\.html|${REPOS}/index\\.html)(?![\\s\\S])`,
);
export type RouteRoot = 'public' | 'internal';
export interface RouteFile {
  readonly root: RouteRoot;
  readonly path: string;
  readonly html: string;
}
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const receiptFile = z
  .object({
    root: z.enum(['public', 'internal']),
    path: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/),
  })
  .strict();
const receiptSchema = z
  .object({
    schema: z.literal('dashboard-generation-candidate/v1'),
    policyGeneration: z.string(),
    configurationDigest: z.string(),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}(?![\s\S])/),
    inputDigest: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/),
    distDigest: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/),
    verifiedRepos: z.number().int().nonnegative(),
    files: z.array(receiptFile),
    prior: z.array(receiptFile),
  })
  .strict();
type Candidate = z.infer<typeof receiptSchema>;

export function ownsGeneratedRoute(root: RouteRoot, path: string): boolean {
  if (
    /[\r\n]/.test(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => part === '..' || part === '.')
  )
    return false;
  return root === 'public'
    ? resultRoute.test(path) ||
        ['index.html', 'evals/index.html', 'status/index.html', GENERATION_MARKER].includes(path)
    : testingRoute.test(path) ||
        (path.startsWith('internal/') && resultRoute.test(path.slice('internal/'.length))) ||
        path === GENERATION_MARKER;
}
async function safePath(root: string, path: string): Promise<string> {
  const base = resolve(root);
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((p) => p === '..' || p === '.')
  )
    throw new Error('unsafe generated path');
  // Include every existing ancestor; a symlink cannot redirect a candidate or target.
  const target = resolve(base, path);
  const parts = target.split(sep).filter(Boolean);
  let current: string = sep;
  for (const part of parts) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('symlink in generated path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}
async function readRegular(path: string): Promise<Buffer> {
  if (!(await lstat(path)).isFile()) throw new Error('generated input must be a regular file');
  return readFile(path);
}
async function validateDestination(root: string, path: string): Promise<void> {
  const target = await safePath(root, path);
  let current = target;
  while (current !== dirname(current)) {
    try {
      const stat = await lstat(current);
      if (current === target ? !stat.isFile() : !stat.isDirectory())
        throw new Error('nonregular generated destination');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    current = dirname(current);
  }
}
function outside(root: string, other: string): boolean {
  const rel = relative(resolve(other), resolve(root));
  return rel === '..' || rel.startsWith(`..${sep}`);
}
async function validateRoots(
  candidate: string,
  publicRoot: string,
  internalRoot: string,
): Promise<void> {
  await assertOperatorInternalRoot(internalRoot, 'generation reconciliation');
  if (
    !outside(publicRoot, internalRoot) ||
    !outside(internalRoot, publicRoot) ||
    !outside(candidate, publicRoot) ||
    !outside(candidate, internalRoot) ||
    !outside(publicRoot, candidate) ||
    !outside(internalRoot, candidate)
  )
    throw new Error('candidate and served roots must be disjoint');
  for (const root of [candidate, publicRoot, internalRoot]) await safePath(root, '');
}
async function inventory(root: string, kind: RouteRoot): Promise<Candidate['files']> {
  const files: Candidate['files'] = [];
  async function visit(path: string): Promise<void> {
    const absolute = await safePath(root, path);
    let stat;
    try {
      stat = await lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isDirectory()) {
      for (const entry of await readdir(absolute)) await visit(path ? `${path}/${entry}` : entry);
    } else if (stat.isFile() && ownsGeneratedRoute(kind, path)) {
      files.push({ root: kind, path, sha256: digest(await readRegular(absolute)) });
    } else if (ownsGeneratedRoute(kind, path)) throw new Error('nonregular owned route');
    // Unrecognized authored files are preserved, never adopted or deleted.
  }
  for (const prefix of kind === 'public'
    ? ['results', 'evals/index.html', 'status/index.html', 'index.html', GENERATION_MARKER]
    : ['internal/results', 'internal/testing', GENERATION_MARKER])
    await visit(prefix);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
function uniqueFiles(files: Candidate['files']): void {
  const seen = new Set<string>();
  for (const file of files) {
    const key = `${file.root}/${file.path}`;
    if (!ownsGeneratedRoute(file.root, file.path) || seen.has(key))
      throw new Error('unknown or duplicate generated route');
    seen.add(key);
  }
}
/** Preparation never modifies either served root. Candidate must be new. */
export async function prepareGenerationCandidate(options: {
  candidate: string;
  publicRoot: string;
  internalRoot: string;
  generation: VerificationGeneration;
  sourceRevision: string;
  inputDigest: string;
  distDigest: string;
  verifiedRepos: number;
  files: readonly RouteFile[];
}): Promise<Candidate> {
  await validateRoots(options.candidate, options.publicRoot, options.internalRoot);
  generationSelector(options.generation);
  const marker = artifactMarker(options.generation, options.sourceRevision);
  const files = [
    ...options.files,
    ...(['public', 'internal'] as const).map((root) => ({
      root,
      path: GENERATION_MARKER,
      html: marker,
    })),
  ];
  const receipt = receiptSchema.parse({
    schema: 'dashboard-generation-candidate/v1',
    ...options.generation,
    sourceRevision: options.sourceRevision,
    inputDigest: options.inputDigest,
    distDigest: options.distDigest,
    verifiedRepos: options.verifiedRepos,
    files: files.map((f) => ({ root: f.root, path: f.path, sha256: digest(f.html) })),
    prior: [
      ...(await inventory(options.publicRoot, 'public')),
      ...(await inventory(options.internalRoot, 'internal')),
    ],
  });
  uniqueFiles(receipt.files);
  await mkdir(options.candidate, { recursive: false, mode: 0o700 });
  for (const file of files) {
    const target = await safePath(options.candidate, `${file.root}/${file.path}`);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, file.html, { flag: 'wx', mode: 0o600 });
  }
  await writeFile(
    join(options.candidate, 'candidate.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return receipt;
}
/** Explicit local application, not deployment. Validate all bytes before any change. */
export async function applyGenerationCandidate(options: {
  candidate: string;
  backup: string;
  publicRoot: string;
  internalRoot: string;
  generation: VerificationGeneration;
  sourceRevision: string;
  inputDigest: string;
  distDigest: string;
  allowEmpty: boolean;
}): Promise<void> {
  await validateRoots(options.candidate, options.publicRoot, options.internalRoot);
  await validateRoots(options.backup, options.publicRoot, options.internalRoot);
  if (!outside(options.backup, options.candidate) || !outside(options.candidate, options.backup))
    throw new Error('backup overlaps candidate');
  const receipt = receiptSchema.parse(
    JSON.parse(
      (await readRegular(await safePath(options.candidate, 'candidate.json'))).toString('utf8'),
    ),
  );
  generationSelector(receipt);
  if (
    receipt.policyGeneration !== options.generation.policyGeneration ||
    receipt.configurationDigest !== options.generation.configurationDigest ||
    receipt.sourceRevision !== options.sourceRevision
  )
    throw new Error('candidate generation/source mismatch');
  if (receipt.inputDigest !== options.inputDigest || receipt.distDigest !== options.distDigest) {
    throw new Error('candidate compiled build identity mismatch');
  }
  if (receipt.verifiedRepos === 0 && !options.allowEmpty)
    throw new Error('zero-verified-evidence migration requires explicit acknowledgement');
  uniqueFiles(receipt.files);
  uniqueFiles(receipt.prior);
  const current = [
    ...(await inventory(options.publicRoot, 'public')),
    ...(await inventory(options.internalRoot, 'internal')),
  ];
  if (JSON.stringify(current) !== JSON.stringify(receipt.prior))
    throw new Error('served routes changed since preparation');
  const contents = new Map<string, Buffer>();
  for (const file of receipt.files) {
    const bytes = await readRegular(await safePath(options.candidate, `${file.root}/${file.path}`));
    if (digest(bytes) !== file.sha256) throw new Error('candidate file digest mismatch');
    contents.set(`${file.root}/${file.path}`, bytes);
  }
  // A receipt cannot omit the admission markers or substitute another generation.
  const expectedMarker = artifactMarker(options.generation, options.sourceRevision);
  for (const root of ['public', 'internal'] as const) {
    if (contents.get(`${root}/${GENERATION_MARKER}`)?.toString('utf8') !== expectedMarker) {
      throw new Error('missing or mismatched candidate generation marker');
    }
  }
  for (const key of [
    'public/index.html',
    'public/results/index.html',
    'public/evals/index.html',
    'public/status/index.html',
    'internal/internal/results/index.html',
    'internal/internal/testing/index.html',
  ]) {
    if (!contents.has(key)) throw new Error('incomplete generated route candidate');
  }
  const roots = { public: options.publicRoot, internal: options.internalRoot };
  for (const file of receipt.files) await validateDestination(roots[file.root], file.path);
  await mkdir(options.backup, { recursive: false, mode: 0o700 });
  for (const file of receipt.prior) {
    const target = await safePath(options.backup, `${file.root}/${file.path}`);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, await readRegular(await safePath(roots[file.root], file.path)), {
      flag: 'wx',
      mode: 0o600,
    });
  }
  // Invalidate both prior markers BEFORE touching routes. Failure never restores old trust.
  // An incomplete checkout must not be published; backups are for investigation only.
  for (const root of ['public', 'internal'] as const) {
    await mkdir(roots[root], { recursive: true });
    await writeFile(
      await safePath(roots[root], GENERATION_MARKER),
      JSON.stringify({
        schema: 'dashboard-artifact-generation/v1',
        state: 'application-in-progress',
      }) + '\n',
    );
  }
  for (const file of receipt.files.filter((file) => file.path !== GENERATION_MARKER)) {
    const target = await safePath(roots[file.root], file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents.get(`${file.root}/${file.path}`)!);
  }
  for (const file of receipt.prior) {
    if (!contents.has(`${file.root}/${file.path}`))
      await unlink(await safePath(roots[file.root], file.path));
  }
  for (const root of ['public', 'internal'] as const) {
    await writeFile(await safePath(roots[root], GENERATION_MARKER), expectedMarker);
  }
}
