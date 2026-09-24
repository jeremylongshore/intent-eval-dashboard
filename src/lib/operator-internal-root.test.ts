import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertOperatorInternalRoot, isInsidePublicOrigin } from './operator-internal-root.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function sandbox(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'iep-dashboard-root-guard-'));
  roots.push(root);
  return root;
}

describe('operator-internal output root guard', () => {
  it('accepts an operator-internal root, existing or not yet created', async () => {
    const root = await sandbox();
    await expect(assertOperatorInternalRoot(join(root, 'site-internal'), 't')).resolves.toBe(
      join(root, 'site-internal'),
    );
    await mkdir(join(root, 'site-internal'));
    await expect(assertOperatorInternalRoot(join(root, 'site-internal', 'x'), 't')).resolves.toBe(
      join(root, 'site-internal', 'x'),
    );
    // A name that merely contains "site" is not the public origin.
    expect(isInsidePublicOrigin(join(root, 'website', 'site-internal'))).toBe(false);
  });

  it('refuses the public origin itself and every path inside it', async () => {
    const root = await sandbox();
    for (const bad of [
      join(root, 'site'),
      join(root, 'site') + '/',
      join(root, 'site', 'sub'),
      join(root, 'site', 'sub', 'deeper'),
      join(root, 'site-internal', '..', 'site', 'sub'),
      join(root, 'x', '..', 'site'),
    ]) {
      expect(isInsidePublicOrigin(bad), bad).toBe(true);
      await expect(assertOperatorInternalRoot(bad, 'generate-x'), bad).rejects.toThrow(
        'generate-x: refusing to write operator-internal output into the public origin "site/"',
      );
    }
  });

  it('refuses a symlinked root that physically resolves into the public origin', async () => {
    const root = await sandbox();
    await mkdir(join(root, 'site', 'sub'), { recursive: true });
    await symlink(join(root, 'site'), join(root, 'site-internal'));
    await symlink(join(root, 'site', 'sub'), join(root, 'innocent'));

    // Lexically these look fine; physically they are the public tree.
    expect(isInsidePublicOrigin(join(root, 'site-internal'))).toBe(false);
    await expect(assertOperatorInternalRoot(join(root, 'site-internal'), 't')).rejects.toThrow(
      'public origin',
    );
    await expect(
      assertOperatorInternalRoot(join(root, 'innocent', 'not-created-yet'), 't'),
    ).rejects.toThrow('public origin');
  });
});
