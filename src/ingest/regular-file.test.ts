import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRegularFile } from './regular-file.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});
let root: string;
beforeEach(async () => {
  const actual = await vi.importActual<typeof fs>('node:fs/promises');
  vi.mocked(fs.open).mockImplementation(actual.open);
  root = await fs.mkdtemp(join(tmpdir(), 'regular-read-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('descriptor-bound regular file reads', () => {
  it('reads exact bytes and does not follow a symlink replacement after open', async () => {
    const file = join(root, 'candidate');
    const other = join(root, 'other');
    await fs.writeFile(file, Buffer.from([0, 128, 255, 10]));
    await fs.writeFile(other, 'replacement');
    const actual = await vi.importActual<typeof fs>('node:fs/promises');
    let opened: fs.FileHandle | undefined;
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      const handle = await actual.open(path, flags, mode);
      opened = handle;
      await fs.rename(file, join(root, 'original'));
      await fs.symlink(other, file);
      return handle;
    });
    expect(await readRegularFile(file)).toEqual(Buffer.from([0, 128, 255, 10]));
    expect(opened?.fd).toBe(-1);
  });
  it('refuses final symlinks, directories, FIFOs and missing files without blocking', async () => {
    const file = join(root, 'candidate');
    await fs.writeFile(file, 'bytes');
    await fs.symlink(file, join(root, 'link'));
    await expect(readRegularFile(join(root, 'link'))).rejects.toMatchObject({ code: 'ELOOP' });
    await expect(readRegularFile(root)).rejects.toThrow('regular file');
    const fifo = join(root, 'fifo');
    execFileSync('mkfifo', [fifo]);
    await expect(readRegularFile(fifo)).rejects.toThrow('regular file');
    await expect(readRegularFile(join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('closes the descriptor when reading fails after successful regular-file admission', async () => {
    const file = join(root, 'candidate');
    await fs.writeFile(file, 'bytes');
    const actual = await vi.importActual<typeof fs>('node:fs/promises');
    let opened: fs.FileHandle | undefined;
    vi.mocked(fs.open).mockImplementation(async (path, flags, mode) => {
      const handle = await actual.open(path, flags, mode);
      opened = handle;
      vi.spyOn(handle, 'readFile').mockRejectedValue(new Error('read failure'));
      return handle;
    });
    await expect(readRegularFile(file)).rejects.toThrow('read failure');
    expect(opened?.fd).toBe(-1);
  });
});
