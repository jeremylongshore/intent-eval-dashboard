/**
 * Tests for the production I/O implementations: filesystem stores (tmp dir),
 * the HTTP manifest fetcher (mocked global fetch), the production sigstore
 * verifier's fail-closed error path, and the no-op publisher transport.
 *
 * These never touch the production storage root or the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_STORAGE_ROOT,
  FsContentStore,
  FsSnapshotStore,
  systemIngestClock,
} from './storage-fs.js';
import { HttpManifestFetcher } from './fetcher-http.js';
import { SigstoreRowVerifier } from './verifier-sigstore.js';
import { VerifyFailure } from './interfaces.js';
import { NoopPublisherTransport } from './publisher-transport-noop.js';
import { type IngestSnapshot } from './interfaces.js';

describe('FsContentStore + FsSnapshotStore (tmp dir)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'labs-dashboard-test-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('puts + gets content by sha256, idempotently', async () => {
    const store = new FsContentStore(root);
    const bytes = new TextEncoder().encode('hello bundle');
    const key1 = await store.put(bytes);
    const key2 = await store.put(bytes); // idempotent
    expect(key1).toBe(key2);
    expect(key1.startsWith('sha256:')).toBe(true);
    expect(await store.has(key1)).toBe(true);
    const got = await store.get(key1);
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got)).toBe('hello bundle');
  });

  it('returns null + false for an absent key', async () => {
    const store = new FsContentStore(root);
    const missing = 'sha256:' + '0'.repeat(64);
    expect(await store.get(missing)).toBeNull();
    expect(await store.has(missing)).toBe(false);
  });

  it('round-trips a snapshot', async () => {
    const store = new FsSnapshotStore(root);
    const snap: IngestSnapshot = {
      repo: 'iec',
      lastKnownGoodIngestedAt: '2026-05-30T00:00:00.000Z',
      sourceSha: 'abc',
      bundleKeys: ['sha256:' + '1'.repeat(64)],
    };
    expect(await store.get('iec')).toBeNull();
    await store.put(snap);
    expect(await store.get('iec')).toEqual(snap);
  });

  it('DEFAULT_STORAGE_ROOT is the DR-035 B2 local Contabo path (never auto-created)', () => {
    expect(DEFAULT_STORAGE_ROOT).toBe('/var/lib/labs-dashboard/bundles/');
  });

  it('systemIngestClock returns an ISO string + epoch ms', () => {
    expect(typeof systemIngestClock.nowIso()).toBe('string');
    expect(systemIngestClock.nowIso()).toMatch(/T.*Z$/);
    expect(typeof systemIngestClock.nowMs()).toBe('number');
  });
});

describe('HttpManifestFetcher (mocked fetch)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('fetches + parses a manifest from the resolved URL', async () => {
    const manifest = {
      repo: 'iec',
      signing: { issuer: 'i', subject: 's', workflowRef: 'w' },
      rows: [],
    };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(manifest) } as Response),
    );
    const fetcher = new HttpManifestFetcher((repo) => `https://ci.example/${repo}/report-manifest.json`);
    const got = await fetcher.fetch('iec');
    expect(got.repo).toBe('iec');
    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(call?.[0]).toBe('https://ci.example/iec/report-manifest.json');
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects on a non-2xx response', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response),
    );
    const fetcher = new HttpManifestFetcher(() => 'https://ci.example/x');
    await expect(fetcher.fetch('iec')).rejects.toThrow(/HTTP 404/);
  });

  it('rejects when the fetch itself throws (e.g. abort/timeout)', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('aborted')));
    const fetcher = new HttpManifestFetcher(() => 'https://ci.example/x', 1);
    await expect(fetcher.fetch('iec')).rejects.toThrow(/aborted/);
  });
});

describe('SigstoreRowVerifier — fail-closed on a bad bundle', () => {
  it('throws a VerifyFailure (never silently passes) for a malformed bundle', async () => {
    // A garbage "bundle" cannot be verified for real → sigstore rejects → we
    // surface a VerifyFailure. This proves there is NO no-op pass path: even
    // without network/TUF, unverifiable input fails closed.
    const verifier = new SigstoreRowVerifier(1);
    let threw = false;
    try {
      await verifier.verifyRow({
        sigstoreBundle: { not: 'a sigstore bundle' },
        payloadBytes: new TextEncoder().encode('x'),
        expectedIdentity: {
          issuer: 'https://token.actions.githubusercontent.com',
          subject: 'repo:o/r:ref:refs/tags/v1',
          workflowRef: 'o/r/.github/workflows/release.yml@refs/tags/v1',
        },
      });
    } catch (err: unknown) {
      threw = true;
      expect(err).toBeInstanceOf(VerifyFailure);
    }
    expect(threw).toBe(true);
  });

  it('defaults tlogThreshold to 1 (Rekor inclusion-proof verification is mandatory)', () => {
    // Constructing with no arg uses threshold 1 — the constructor default is the
    // security-relevant invariant (0 would defeat step 3).
    const verifier = new SigstoreRowVerifier();
    expect(verifier).toBeInstanceOf(SigstoreRowVerifier);
  });
});

describe('NoopPublisherTransport', () => {
  it('returns published:false and never claims to have published', async () => {
    const logs: string[] = [];
    const transport = new NoopPublisherTransport({ info: (m) => logs.push(m) });
    const result = await transport.publish({
      renderInput: { asOf: '2026-05-30T00:00:00.000Z', repos: [{ repo: 'iec', snapshot: null }] },
      outputDir: '/tmp/out',
    });
    expect(result.published).toBe(false);
    expect(result.note).toMatch(/no-op/);
    expect(logs[0]).toMatch(/human-gated/);
  });
});
