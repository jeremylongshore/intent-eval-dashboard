/**
 * Retraction generator + synthetic end-to-end test (bead puxu.10).
 *
 * In-process (no VPS): add an entry to a denylist file -> regenerate -> assert
 * the snippet has the 410 directive AND the tombstone file exists on disk. The
 * real "<4h, deep URL returns 410" is the VPS rsync + caddy reload step (see the
 * 4-hour SLO runbook); here we prove the GENERATION chain deterministically.
 *
 * Also covers: empty denylist -> no-op snippet + zero tombstones; a missing file
 * -> treated as empty (valid); an INVALID file -> fail closed (DenylistInvalidError).
 */

import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildArtifacts,
  DenylistInvalidError,
  generateRetractions,
  loadDenylist,
} from './generate.js';
import { tombstoneRepoPath } from './paths.js';
import { type RetractionEntry } from './denylist.js';

const ENTRY: RetractionEntry = {
  bundle_id: '0190b8e5-7c1a-7000-8000-000000000000',
  deep_url_path: '/results/iec/0190b8e5/',
  reason_class: 'partner-request',
  retracted_at: '2026-06-04T12:00:00Z',
  note: 'partner requested removal',
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'iep-retraction-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('buildArtifacts — pure', () => {
  it('an empty denylist -> no-op snippet + zero tombstones', () => {
    const out = buildArtifacts([]);
    expect(out.tombstones).toHaveLength(0);
    expect(out.snippet.content).toContain('(no retractions');
    expect(out.snippet.content).not.toContain('status 410');
  });

  it('one entry -> snippet with a 410 + one tombstone file', () => {
    const out = buildArtifacts([ENTRY]);
    expect(out.snippet.content).toContain('status 410');
    expect(out.tombstones).toHaveLength(1);
    expect(out.tombstones[0]?.content).toContain('<!DOCTYPE html>');
    expect(out.tombstones[0]?.path).toContain('retracted/');
  });
});

describe('loadDenylist — fail closed', () => {
  it('treats a MISSING file as empty (valid)', async () => {
    const denylist = await loadDenylist(join(dir, 'nope.json'));
    expect(denylist).toEqual([]);
  });

  it('throws DenylistInvalidError on an out-of-set reason_class', async () => {
    const file = join(dir, 'retractions.json');
    await writeFile(file, JSON.stringify([{ ...ENTRY, reason_class: 'because-i-said-so' }]));
    await expect(loadDenylist(file)).rejects.toBeInstanceOf(DenylistInvalidError);
  });

  it('throws DenylistInvalidError on malformed JSON', async () => {
    const file = join(dir, 'retractions.json');
    await writeFile(file, '{ not valid json');
    await expect(loadDenylist(file)).rejects.toBeInstanceOf(DenylistInvalidError);
  });

  it('throws DenylistInvalidError on a subject-less entry', async () => {
    const file = join(dir, 'retractions.json');
    await writeFile(
      file,
      JSON.stringify([
        {
          deep_url_path: '/results/iec/x/',
          reason_class: 'data-quality',
          retracted_at: '2026-06-04T12:00:00Z',
        },
      ]),
    );
    await expect(loadDenylist(file)).rejects.toBeInstanceOf(DenylistInvalidError);
  });
});

describe('synthetic end-to-end (in-process, no VPS)', () => {
  it('add entry -> regenerate -> snippet has the 410 + the tombstone exists on disk', async () => {
    const jsonPath = join(dir, 'retractions.json');
    const siteRoot = join(dir, 'site');
    const snippetPath = join(dir, 'deploy', 'retractions.snippet');

    // 1. Add a retraction entry.
    await writeFile(jsonPath, JSON.stringify([ENTRY], null, 2));

    // 2. Regenerate.
    const { written } = await generateRetractions(jsonPath, { snippetPath, siteRoot });

    // 3a. The snippet on disk has the 410 directive for the deep URL.
    const snippet = await readFile(snippetPath, 'utf8');
    expect(snippet).toContain('status 410');
    expect(snippet).toContain('handle /results/iec/0190b8e5/');

    // 3b. The tombstone file exists at the deterministic location.
    const tombAbs = join(siteRoot, tombstoneRepoPath(ENTRY.deep_url_path));
    const tomb = await stat(tombAbs);
    expect(tomb.isFile()).toBe(true);
    const tombHtml = await readFile(tombAbs, 'utf8');
    expect(tombHtml).toContain('exists in the transparency log');
    expect(tombHtml).toContain('partner-request');

    // Both files were reported as written.
    expect(written).toContain(snippetPath);
    expect(written).toContain(tombAbs);
  });

  it('starting empty -> adding one entry produces exactly the new 410 + tombstone (idempotent delta)', async () => {
    const jsonPath = join(dir, 'retractions.json');
    const siteRoot = join(dir, 'site');
    const snippetPath = join(dir, 'deploy', 'retractions.snippet');

    // Start empty.
    await writeFile(jsonPath, '[]');
    const first = await generateRetractions(jsonPath, { snippetPath, siteRoot });
    expect(first.artifacts.tombstones).toHaveLength(0);
    expect(await readFile(snippetPath, 'utf8')).not.toContain('status 410');

    // Add one entry + regenerate.
    await writeFile(jsonPath, JSON.stringify([ENTRY]));
    const second = await generateRetractions(jsonPath, { snippetPath, siteRoot });
    expect(second.artifacts.tombstones).toHaveLength(1);
    expect(await readFile(snippetPath, 'utf8')).toContain('status 410');
  });
});
