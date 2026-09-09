/**
 * The scheduled regeneration workflow must not treat an ingest/render crash as
 * a successful verification run. Otherwise log lines emitted before a render
 * failure could authorize a commit and deploy of incomplete output.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('regenerate workflow ingest/render completion gate', () => {
  it('fails closed on command failure and requires the terminal completion signal', async () => {
    const workflow = await readFile(
      new URL('../../.github/workflows/regenerate.yml', import.meta.url),
      'utf8',
    );

    expect(workflow).not.toMatch(/run_ingest\s*\|\|\s*true/);
    expect(workflow).toContain('if ! run_ingest; then');
    expect(workflow).toContain("grep -q '^✓ ingest-render complete '");
    expect(workflow).toContain('refusing to commit or deploy');
  });
});
