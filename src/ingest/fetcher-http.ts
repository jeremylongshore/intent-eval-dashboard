/**
 * Production manifest fetcher (step 1) — HTTPS GET of `report-manifest.json`.
 *
 * Behind the {@link ManifestFetcher} interface so tests inject fixtures. The
 * default uses global `fetch` (Node 20+) with a timeout. A network timeout /
 * non-2xx / malformed JSON rejects, and the worker maps that to a step-1 crash
 * (the supervisor then keeps the prior snapshot for that repo).
 */

import { type ManifestFetcher } from './interfaces.js';
import { type ReportManifest } from './manifest.js';

/** Resolve a repo key to its manifest URL. */
export type ManifestUrlResolver = (repo: string) => string;

export class HttpManifestFetcher implements ManifestFetcher {
  constructor(
    private readonly resolveUrl: ManifestUrlResolver,
    private readonly timeoutMs = 5000,
  ) {}

  async fetch(repo: string): Promise<ReportManifest> {
    const url = this.resolveUrl(repo);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`manifest fetch ${url} returned HTTP ${res.status}`);
      }
      const json: unknown = await res.json();
      return json as ReportManifest;
    } finally {
      clearTimeout(timer);
    }
  }
}
