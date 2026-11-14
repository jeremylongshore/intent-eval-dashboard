/** Inspect and read the same opened file; never follow a final-component symlink. */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

export async function readRegularFile(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('generated input must be a regular file');
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
