/** Existing tsc build plus local integrity receipt; not a signing or release attestation. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RECEIPT = 'dist/.build-provenance.json';
// Generated/public output and project records cannot affect the renderer build.
// content/, data/, ingest/, config files and all executable source remain inputs.
const excluded =
  /^(?:site\/|site-internal\/|deploy\/retractions\.snippet$|000-docs\/|docs\/|\.beads\/|\.harness-hash$|(?:README|CHANGELOG|AGENTS|CLAUDE)\.md$)/;
export function inputPaths(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path && !excluded.test(path))
    .sort();
}
function hashFiles(root, paths) {
  const hash = createHash('sha256');
  for (const path of paths) {
    if (!lstatSync(join(root, path)).isFile())
      throw new Error('build input/output must be a regular file');
    const bytes = readFileSync(join(root, path));
    hash.update(JSON.stringify([path, bytes.length]) + '\n');
    hash.update(bytes);
  }
  return hash.digest('hex');
}
function distPaths(root, prefix = 'dist') {
  return readdirSync(join(root, prefix))
    .sort()
    .flatMap((name) => {
      const path = `${prefix}/${name}`;
      if (path === RECEIPT) return [];
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) throw new Error('symlink in compiled output');
      return stat.isDirectory() ? distPaths(root, path) : [path];
    });
}
export function verifyBuildProvenance(root) {
  const receipt = JSON.parse(readFileSync(join(root, RECEIPT), 'utf8'));
  const paths = inputPaths(root);
  if (
    receipt.schema !== 'dashboard-local-build/v1' ||
    receipt.inputDigest !== hashFiles(root, paths) ||
    receipt.distDigest !== hashFiles(root, distPaths(root))
  )
    throw new Error('stale or modified compiled renderer; run pnpm build');
  return receipt;
}
export function requireCommittedInputs(root) {
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  if ([...changed, ...untracked].some((path) => path && !excluded.test(path))) {
    throw new Error('generation preparation/application requires committed generation inputs');
  }
}
export function build(root) {
  const paths = inputPaths(root);
  const inputDigest = hashFiles(root, paths);
  // Sibling output preserves source-map relative paths; ignored staging is retained on failure.
  const staging = mkdtempSync(join(root, '.dist-build-'));
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json', '--outDir', staging], {
    cwd: root,
    stdio: 'inherit',
  });
  if (
    JSON.stringify(paths) !== JSON.stringify(inputPaths(root)) ||
    inputDigest !== hashFiles(root, paths)
  ) {
    throw new Error('generation inputs changed during compilation');
  }
  const gitDir = resolve(
    root,
    execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim(),
  );
  const archive = join(gitDir, 'task-receipts', 'compiled-output-backups');
  mkdirSync(archive, { recursive: true, mode: 0o700 });
  const backup = mkdtempSync(join(archive, 'build-'));
  if (existsSync(join(root, 'dist'))) {
    if (
      !lstatSync(join(root, 'dist')).isDirectory() ||
      lstatSync(join(root, 'dist')).isSymbolicLink()
    )
      throw new Error('dist must be an owned generated directory');
    renameSync(join(root, 'dist'), join(backup, 'dist'));
  }
  // Never delete unknown old files: preserve the entire prior output outside serving/add-A.
  renameSync(staging, join(root, 'dist'));
  writeFileSync(
    join(root, RECEIPT),
    JSON.stringify({
      schema: 'dashboard-local-build/v1',
      inputDigest,
      distDigest: hashFiles(root, distPaths(root)),
      compilerSourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim(),
    }) + '\n',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  build(process.cwd());
