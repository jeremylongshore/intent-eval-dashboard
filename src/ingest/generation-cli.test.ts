/** Actual CLI subprocesses, real compiled orchestration, and denied network transport. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mintManifest } from './__fixtures__/bundle-fixtures.js';

let root: string;
let preloader: string;
const checkout = process.cwd();
function cli(args: string[], fixtureEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    process.execPath,
    ['--import', preloader, '--experimental-strip-types', 'scripts/ingest-render.ts', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...fixtureEnv },
      timeout: 30000,
    },
  );
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'generation-cli-'));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: checkout, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  for (const path of tracked) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(join(checkout, path), join(root, path));
  }
  await cp(join(checkout, 'dist'), join(root, 'dist'), { recursive: true });
  await symlink(join(checkout, 'node_modules'), join(root, 'node_modules'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  await writeFile(join(root, '.git/info/exclude'), '/node_modules\n');
  execFileSync('git', ['add', '--', ...tracked], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'isolated CLI fixture',
    ],
    { cwd: root },
  );
  preloader = join(root, '.git', 'deny-network.mjs');
  await writeFile(
    preloader,
    `import { writeFileSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
function denied() { writeFileSync('.git/network-denied', 'attempted'); throw new Error('test denies network'); }
net.Socket.prototype.connect = denied;
globalThis.fetch = process.env.GENERATION_EMPTY_FIXTURE ? async url => {
  if (String(url).includes('/jeremylongshore/intent-eval-core/')) return new Response(readFileSync(process.env.GENERATION_EMPTY_FIXTURE), { status: 200 });
  return denied();
} : denied;
syncBuiltinESMExports();\n`,
  );
}, 30000);
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('default migration CLI and explicit local preparation', () => {
  it('refuses missing generation before network or output writes', async () => {
    const landing = await readFile(join(root, 'site/index.html'));
    const result = cli([]);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('MIGRATION_REQUIRED');
    expect(await readFile(join(root, 'site/index.html'))).toEqual(landing);
    await expect(readFile(join(root, '.git/network-denied'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('prepares isolated zero-evidence output, refuses implicit apply, and retains normal blackout completion', async () => {
    const landing = await readFile(join(root, 'site/index.html'));
    const candidate = join(root, '.git', 'candidate');
    const prepared = cli(['--prepare-trust-migration', candidate]);
    expect(prepared.status, prepared.stderr).toBe(0);
    expect(prepared.stdout).toContain('0 repos supplied newly verified rows');
    expect(await readFile(join(root, 'site/index.html'))).toEqual(landing);
    const receiptPath = join(candidate, 'candidate.json');
    const receipt = await readFile(receiptPath, 'utf8');
    const mismatched = receipt.replace(
      /"distDigest": "[a-f0-9]{64}"/,
      `"distDigest": "${'f'.repeat(64)}"`,
    );
    expect(mismatched).not.toBe(receipt);
    await writeFile(receiptPath, mismatched);
    try {
      const incompatible = cli([
        '--apply-prepared-generation',
        candidate,
        '--allow-empty-trust-migration',
      ]);
      expect(incompatible.status).toBe(1);
      expect(incompatible.stderr).toContain('compiled build identity mismatch');
      expect(await readFile(join(root, 'site/index.html'))).toEqual(landing);
    } finally {
      await writeFile(receiptPath, receipt);
    }
    const refused = cli(['--apply-prepared-generation', candidate]);
    expect(refused.status, refused.stderr).toBe(1);
    expect(refused.stderr).toContain('zero-verified-evidence');
    const applied = cli([
      '--apply-prepared-generation',
      candidate,
      '--allow-empty-trust-migration',
    ]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stdout).toContain('deployed activation is NOT verified');
    const later = cli([]);
    expect(later.status, later.stderr).toBe(0);
    expect(later.stdout).toContain('✓ ingest-render complete');
    expect(later.stdout).not.toContain(': VERIFIED');
  }, 30000);
  it('empty claimed manifests cannot emit VERIFIED or overwrite an existing current-generation snapshot', async () => {
    const selection = cli(['--print-generation']);
    expect(selection.status, selection.stderr).toBe(0);
    const path = join(root, '.ingest-store', selection.stdout.trim(), 'snapshots/iec.json');
    await mkdir(dirname(path), { recursive: true });
    const snapshot = {
      repo: 'iec',
      lastKnownGoodIngestedAt: '2026-11-12T00:00:00Z',
      sourceSha: 'c'.repeat(40),
      bundleKeys: [],
    };
    await writeFile(path, JSON.stringify(snapshot));
    const fixture = join(root, '.git/empty-manifest.json');
    await writeFile(
      fixture,
      JSON.stringify(mintManifest('iec', 'jeremylongshore/intent-eval-core', 0)),
    );
    const result = cli([], { GENERATION_EMPTY_FIXTURE: fixture });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain(': VERIFIED');
    expect(result.stdout).toContain('iec: no-data (fetch_manifest/manifest_malformed)');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(snapshot);
  }, 30000);
  it('refuses changed generation inputs and modified or missing compiled bytes', async () => {
    const config = join(root, 'tsconfig.build.json');
    const original = await readFile(config);
    await writeFile(config, Buffer.concat([original, Buffer.from('\n')]));
    expect(cli([]).stderr).toContain('committed generation inputs');
    await writeFile(config, original);
    const output = join(root, 'dist/ingest/renderer.js');
    const compiled = await readFile(output);
    const canary = join(root, '.git/compiled-code-executed');
    await writeFile(
      output,
      Buffer.concat([
        compiled,
        Buffer.from(
          `\nimport { writeFileSync as writeCanary } from 'node:fs'; writeCanary(${JSON.stringify(canary)}, 'executed');\n`,
        ),
      ]),
    );
    try {
      expect(cli([]).stderr).toContain('stale or modified compiled renderer');
      expect(cli(['--print-generation']).stderr).toContain('stale or modified compiled renderer');
      await expect(readFile(canary)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await writeFile(output, compiled);
    }
    const receipt = join(root, 'dist/.build-provenance.json');
    const saved = await readFile(receipt);
    await rm(receipt);
    expect(cli([]).status).toBe(1);
    await writeFile(receipt, saved);
  });
  it('rejects untracked executable input and rebuilds without blessing obsolete dist files', async () => {
    const extra = join(root, 'scripts/untracked-render.mjs');
    await writeFile(extra, '// untracked source');
    expect(cli([]).stderr).toContain('committed generation inputs');
    await rm(extra);
    const obsolete = join(root, 'dist/obsolete-module.js');
    await writeFile(obsolete, 'historical output');
    expect(cli([]).stderr).toContain('stale or modified compiled renderer');
    const rebuilt = spawnSync(process.execPath, ['scripts/build-provenance.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
    });
    expect(rebuilt.status, rebuilt.stderr).toBe(0);
    await expect(readFile(obsolete)).rejects.toMatchObject({ code: 'ENOENT' });
    // A clean rebuilt output is admitted, even though its prior stale module is archived.
    expect(cli([]).status).toBe(0);
  }, 30000);
  it('refuses a script from another checkout before validating or importing its dist', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        preloader,
        '--experimental-strip-types',
        join(checkout, 'scripts/ingest-render.ts'),
        '--print-generation',
      ],
      { cwd: root, encoding: 'utf8', timeout: 10000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('collector cwd must match the entry script checkout');
  });
  it('workflow preparation cannot publish and cache restore cannot cross policy/config generations', async () => {
    const workflow = await readFile(join(checkout, '.github/workflows/regenerate.yml'), 'utf8');
    expect(workflow).toContain('ingest-store-${{ steps.generation.outputs.key }}-');
    expect(workflow).not.toMatch(/restore-keys:\s*ingest-store-\s*\n/);
    for (const step of ['Commit + push', 'Trigger deploy']) {
      const block = workflow.slice(workflow.indexOf(`- name: ${step}`)).split('\n      - name:')[0];
      expect(block).toContain('inputs.prepare_trust_generation != true');
      expect(block).toContain("steps.ingest.outputs.blackout != 'true'");
    }
  });
});
