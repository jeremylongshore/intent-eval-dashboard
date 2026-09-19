/**
 * The one guard that keeps operator-internal output out of the public origin.
 *
 * The public site is deployed from a directory named `site/` and the deploy
 * workflow triggers on `site/**`. Every generator that writes tailnet-only or
 * basicauth-gated pages MUST resolve its output root through
 * `assertOperatorInternalRoot` (DR-035 § 8, visibility-tier gate, fail-closed).
 *
 * Earlier guards compared only the final path segment
 * (`basename(root) === 'site'`). That accepted `site/sub`, which is inside the
 * public tree and would be deployed. This guard checks containment instead,
 * both lexically and after resolving symlinks.
 */
import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

const PUBLIC_ORIGIN_SEGMENT = 'site';

/**
 * True when a path IS the public origin or lies anywhere inside it. Any `site`
 * segment refuses, so this fails closed: an operator whose checkout lives under
 * a directory called `site` must pass a root outside it.
 */
export function isInsidePublicOrigin(path: string): boolean {
  return resolve(path).split(sep).includes(PUBLIC_ORIGIN_SEGMENT);
}

/**
 * Resolve symlinks on the part of the path that already exists. `resolve()` is
 * purely lexical, so without this a pre-existing `site-internal -> site`
 * symlink would pass the lexical check and still write into the public tree.
 */
async function physicalPath(path: string): Promise<string> {
  let existing = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(await realpath(existing), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) return resolve(path);
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

/**
 * Return the resolved output root, or throw if it is, is inside, or physically
 * resolves into the public origin. `label` names the caller in the message.
 */
export async function assertOperatorInternalRoot(root: string, label: string): Promise<string> {
  const resolved = resolve(root);
  if (isInsidePublicOrigin(resolved) || isInsidePublicOrigin(await physicalPath(resolved))) {
    throw new Error(
      `${label}: refusing to write operator-internal output into the public origin "site/" ` +
        `(requested root resolves to ${resolved}). Use "site-internal" or another operator-only root.`,
    );
  }
  return resolved;
}
