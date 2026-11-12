import type { ManifestFetcher } from '../ingest/interfaces.js';
import { isReportManifestShape, type ReportManifest } from '../ingest/manifest.js';
import type { PrivateConfig, PrivateSource } from './config.js';
import { PrivateIngestError } from './reason.js';

export interface CredentialProvider {
  token(reference: string, githubRepo: string): Promise<string>;
}
export type PrivateHttp = (url: string, init: RequestInit) => Promise<Response>;
export const PRIVATE_LIMITS = {
  metadataBytes: 1024 * 1024,
  manifestBytes: 16 * 1024 * 1024,
  pages: 10,
  timeoutMs: 30_000,
} as const;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PrivateIngestError('response_invalid');
  }
  return value as Record<string, unknown>;
}
function positiveId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new PrivateIngestError('response_invalid');
  }
  return value;
}

async function boundedJson(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<unknown> {
  // Fetch exposes decoded body bytes; Content-Length describes wire bytes for
  // compressed responses. Bound decoded bytes regardless of transfer encoding.
  const encoding = response.headers.get('content-encoding');
  const length =
    encoding && encoding !== 'identity' ? null : response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit)) {
    await response.body?.cancel();
    throw new PrivateIngestError('response_too_large');
  }
  if (response.body === null) throw new PrivateIngestError('response_invalid');
  const reader = response.body.getReader();
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      const chunk: unknown = next.value;
      if (!(chunk instanceof Uint8Array)) throw new PrivateIngestError('response_invalid');
      count += chunk.length;
      if (count > limit) {
        await reader.cancel();
        throw new PrivateIngestError('response_too_large');
      }
      chunks.push(chunk);
    }
    if (length !== null && count !== Number(length))
      throw new PrivateIngestError('response_invalid');
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    ) as unknown;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Credentials are attached only to constructed GitHub API paths, never redirects. */
export class PrivateGithubFetcher implements ManifestFetcher {
  constructor(
    private readonly config: PrivateConfig,
    private readonly credentials: CredentialProvider,
    private readonly http: PrivateHttp = fetch,
    private readonly timeoutMs = PRIVATE_LIMITS.timeoutMs as number,
  ) {}

  async fetch(repo: string): Promise<ReportManifest> {
    const source = this.config.sources.find((s) => s.key === repo);
    if (!source) throw new PrivateIngestError('source_not_enrolled');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new PrivateIngestError('request_timeout'));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([this.acquire(source, controller.signal), deadline]);
    } catch (error) {
      if (error instanceof PrivateIngestError) throw error;
      throw new PrivateIngestError('request_failed');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async acquire(source: PrivateSource, signal: AbortSignal): Promise<ReportManifest> {
    const binding = this.config.credentials.find((c) => c.ref === source.credentialRef);
    if (!binding?.repositories.includes(source.githubRepo))
      throw new PrivateIngestError('credential_rejected');
    const token = await this.credentials.token(source.credentialRef, source.githubRepo);
    if (!token || /[\r\n]/u.test(token)) throw new PrivateIngestError('credential_rejected');
    signal.throwIfAborted();
    const base = `https://api.github.com/repos/${source.githubRepo}/releases`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
    };
    const request = async (url: string, accept = headers.Accept): Promise<Response> => {
      signal.throwIfAborted();
      const response = await this.http(url, {
        headers: { ...headers, Accept: accept },
        redirect: 'manual',
        signal,
      });
      return response;
    };
    const selector =
      source.release.kind === 'latest'
        ? 'latest'
        : `tags/${encodeURIComponent(source.release.tag)}`;
    const releaseResponse = await request(`${base}/${selector}`);
    const release = object(await this.metadata(releaseResponse, signal));
    const releaseId = positiveId(release['id']);
    const assetId = await this.findAsset(source, base, releaseId, request, signal);
    let response = await request(`${base}/assets/${assetId}`, 'application/octet-stream');
    if (response.status === 302) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      const url = this.downloadUrl(location);
      signal.throwIfAborted();
      response = await this.http(url, { redirect: 'manual', signal, credentials: 'omit' });
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new PrivateIngestError('request_failed');
    }
    const raw = await boundedJson(response, PRIVATE_LIMITS.manifestBytes, signal);
    if (!isReportManifestShape(raw) || raw.repo !== source.key || raw.rows.length === 0)
      throw new PrivateIngestError('response_invalid');
    return raw;
  }

  private async metadata(response: Response, signal: AbortSignal): Promise<unknown> {
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new PrivateIngestError('request_failed');
    }
    return boundedJson(response, PRIVATE_LIMITS.metadataBytes, signal);
  }

  private async findAsset(
    source: PrivateSource,
    base: string,
    releaseId: number,
    request: (url: string) => Promise<Response>,
    signal: AbortSignal,
  ): Promise<number> {
    let match: number | undefined;
    for (let page = 1; page <= PRIVATE_LIMITS.pages; page++) {
      const raw = await this.metadata(
        await request(`${base}/${releaseId}/assets?per_page=100&page=${page}`),
        signal,
      );
      if (!Array.isArray(raw) || raw.length > 100) throw new PrivateIngestError('response_invalid');
      for (const value of raw) {
        const asset = object(value);
        if (asset['name'] !== source.asset) continue;
        if (match !== undefined) throw new PrivateIngestError('asset_ambiguous');
        if (asset['state'] !== 'uploaded') throw new PrivateIngestError('response_invalid');
        match = positiveId(asset['id']);
      }
      if (raw.length < 100) {
        if (match === undefined) throw new PrivateIngestError('asset_missing');
        return match;
      }
    }
    throw new PrivateIngestError('asset_listing_incomplete');
  }

  private downloadUrl(location: string | null): string {
    if (!location) throw new PrivateIngestError('redirect_rejected');
    let url: URL;
    try {
      url = new URL(location);
    } catch {
      throw new PrivateIngestError('redirect_rejected');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !this.config.downloadHosts.includes(url.hostname)
    ) {
      throw new PrivateIngestError('redirect_rejected');
    }
    return url.href;
  }
}
