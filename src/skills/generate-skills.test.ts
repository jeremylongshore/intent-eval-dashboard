/**
 * Per-skill generator tests — file-map structure, disk write, end-to-end C3.
 *
 * Proves the generator emits the right files, writes them to disk, and that the
 * emitted HTML is C3-clean per the REAL scanner — the same gate `lint:c3` runs
 * over `site/skills/` in CI.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSkillsFiles,
  generateSkillsFiles,
  pathFromUrl,
  writeSkillsSite,
} from './generate-skills.js';
import { buildSkillsView } from './skill-signal-model.js';
import { scanForAggregatePass } from '../results/c3-scan.js';
import {
  FixtureSkillResolver,
  makeHumanReview,
  makeSignals,
  makeUsageEvent,
} from './__fixtures__/skills-fixtures.js';

function resolverWith(skills: Record<string, ReturnType<typeof makeSignals>>) {
  return new FixtureSkillResolver(new Map(Object.entries(skills)));
}

describe('generateSkillsFiles', () => {
  it('emits an index + one page per skill', async () => {
    const resolver = resolverWith({
      alpha: makeSignals({ usageEvents: [makeUsageEvent({ quantity: 4 })] }),
      beta: makeSignals({ humanReviews: [makeHumanReview({ thumbs: true })] }),
    });
    const view = await buildSkillsView(['alpha', 'beta'], resolver);
    const files = generateSkillsFiles(view);
    expect(files.map((f) => f.path).sort()).toEqual([
      'skills/alpha/index.html',
      'skills/beta/index.html',
      'skills/index.html',
    ]);
  });

  it('pathFromUrl maps a skill URL to its index file', () => {
    expect(pathFromUrl('/skills/my-skill/')).toBe('skills/my-skill/index.html');
  });
});

describe('writeSkillsSite + end-to-end C3', () => {
  it('writes files to disk and the emitted HTML is C3-clean', async () => {
    const resolver = resolverWith({
      alpha: makeSignals({
        usageEvents: [makeUsageEvent({ meter: 'skill_invocation', unit: 'count', quantity: 7 })],
        humanReviews: [
          makeHumanReview({ thumbs: true, score_text: '5/5 great', annotation: 'tidy' }),
        ],
        rubricRef: 'https://example.test/r/alpha',
      }),
      beta: makeSignals({}), // fully no-data — must render loud, not crash
    });
    const files = await buildSkillsFiles(['alpha', 'beta'], resolver);

    const dir = await mkdtemp(join(tmpdir(), 'skills-gen-'));
    try {
      const written = await writeSkillsSite(files, dir);
      expect(written.length).toBe(files.length);

      // Re-read every written file and scan it with the production C3 scanner.
      for (const abs of written) {
        const html = await readFile(abs, 'utf8');
        expect(scanForAggregatePass(html)).toEqual([]);
      }

      // The no-data skill rendered loud, not blank.
      const betaHtml = await readFile(join(dir, 'skills/beta/index.html'), 'utf8');
      expect(betaHtml).toContain('badge--no-data');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the current-state empty view (no resolver hits) renders all-no-data without crashing', async () => {
    const view = await buildSkillsView(
      ['iec-skill', 'iel-skill'],
      new FixtureSkillResolver(new Map()),
    );
    const files = generateSkillsFiles(view);
    const index = files.find((f) => f.path === 'skills/index.html');
    expect(index?.html).toContain('no-data');
    expect(scanForAggregatePass(index?.html ?? '')).toEqual([]);
  });
});
