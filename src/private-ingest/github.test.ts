import { describe, expect, it, vi } from 'vitest';
import { PrivateGithubFetcher, PRIVATE_LIMITS, type PrivateHttp } from './github.js';
import {
  configFixture,
  manifestFixture,
  jsonResponse,
  assetFixture,
} from './__fixtures__/config.js';

const credentials = { token: () => Promise.resolve('SYNTHETIC_SECRET_CANARY') };
function fixtureHttp(final: () => Response = () => jsonResponse(manifestFixture())) {
  return vi.fn<PrivateHttp>((url) =>
    Promise.resolve(
      url.includes('/tags/')
        ? jsonResponse({ id: 7 })
        : url.includes('?per_page=')
          ? jsonResponse([assetFixture()])
          : final(),
    ),
  );
}

describe('private GitHub acquisition', () => {
  it('constructs scoped authenticated API requests and accepts a direct asset', async () => {
    const http = fixtureHttp();
    expect(
      await new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
    ).toEqual(manifestFixture());
    expect(http.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/fixture/private/releases/tags/v1',
      'https://api.github.com/repos/fixture/private/releases/7/assets?per_page=100&page=1',
      'https://api.github.com/repos/fixture/private/releases/assets/9',
    ]);
    for (const [, options] of http.mock.calls) {
      expect(options.redirect).toBe('manual');
      expect(new Headers(options.headers).get('authorization')).toBe(
        'Bearer SYNTHETIC_SECRET_CANARY',
      );
    }
  });
  it('strips authorization and cookies from the approved download handoff', async () => {
    const http = fixtureHttp(
      () =>
        new Response(null, {
          status: 302,
          headers: {
            location: 'https://release-assets.githubusercontent.com/file?signature=PRIVATE_QUERY',
          },
        }),
    );
    http
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ id: 7 })))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse([assetFixture()])))
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: {
              location: 'https://release-assets.githubusercontent.com/file?signature=PRIVATE_QUERY',
            },
          }),
        ),
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(manifestFixture())));
    await new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary');
    expect(http.mock.calls[3]?.[1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
    expect(http.mock.calls[3]?.[1].headers).toBeUndefined();
  });
  it.each([
    'http://release-assets.githubusercontent.com/x',
    'https://evil.invalid/x',
    'https://user@release-assets.githubusercontent.com/x',
    'https://release-assets.githubusercontent.com:444/x',
    'https://127.0.0.1/x',
    '/relative',
  ])('rejects redirect %s', async (location) => {
    const http = fixtureHttp(() => new Response(null, { status: 302, headers: { location } }));
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
    ).rejects.toThrow('redirect_rejected');
    expect(http).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403, 404, 302, 500])(
    'rejects metadata status %s without a fallback',
    async (status) => {
      const http = vi.fn<PrivateHttp>(() =>
        Promise.resolve(new Response('SYNTHETIC_SECRET_CANARY', { status })),
      );
      await expect(
        new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
      ).rejects.toThrow(/^request_failed$/u);
      expect(http).toHaveBeenCalledTimes(1);
    },
  );
  it('enforces enrollment and credential binding before networking', async () => {
    const config = configFixture();
    const http = fixtureHttp();
    await expect(
      new PrivateGithubFetcher(config, credentials, http).fetch('other'),
    ).rejects.toThrow('source_not_enrolled');
    config.credentials[0]!.repositories = ['other/repo'];
    await expect(
      new PrivateGithubFetcher(config, credentials, http).fetch('private-canary'),
    ).rejects.toThrow('credential_rejected');
    expect(http).not.toHaveBeenCalled();
  });
  it('matches assets on later pages and ignores upstream URL fields', async () => {
    const http = fixtureHttp();
    http
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ id: 7, url: 'https://evil.invalid' })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse(Array.from({ length: 100 }, () => ({ name: 'other' })))),
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse([assetFixture()])));
    await new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary');
    expect(http.mock.calls[2]?.[0]).toContain('page=2');
  });
  it.each(['duplicate', 'missing', 'budget', 'invalid-id'])(
    'fails closed for asset listing %s',
    async (mode) => {
      const http = fixtureHttp();
      http.mockImplementation((url) =>
        Promise.resolve(
          url.includes('/tags/')
            ? jsonResponse({ id: 7 })
            : jsonResponse(
                mode === 'duplicate'
                  ? [assetFixture(), assetFixture()]
                  : mode === 'missing'
                    ? []
                    : mode === 'invalid-id'
                      ? [{ ...assetFixture(), id: 1.5 }]
                      : Array.from({ length: 100 }, () => ({ name: 'other' })),
              ),
        ),
      );
      const code = {
        duplicate: 'asset_ambiguous',
        missing: 'asset_missing',
        budget: 'asset_listing_incomplete',
        'invalid-id': 'response_invalid',
      }[mode];
      await expect(
        new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
      ).rejects.toThrow(code);
    },
  );
  it.each(['length', 'stream', 'utf8', 'json', 'repo'])(
    'rejects invalid manifest %s',
    async (mode) => {
      const http = fixtureHttp(() => {
        if (mode === 'length')
          return new Response('{}', {
            headers: { 'content-length': String(PRIVATE_LIMITS.manifestBytes + 1) },
          });
        if (mode === 'stream')
          return new Response(new Uint8Array(PRIVATE_LIMITS.manifestBytes + 1));
        if (mode === 'utf8') return new Response(new Uint8Array([0xff]));
        if (mode === 'json') return new Response('{');
        return jsonResponse({ ...manifestFixture(), repo: 'another-source' });
      });
      await expect(
        new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
      ).rejects.toThrow();
    },
  );
  it('cancels a stalled body at the total deadline', async () => {
    const cancel = vi.fn();
    const http = fixtureHttp(() => new Response(new ReadableStream({ cancel })));
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http, 25).fetch('private-canary'),
    ).rejects.toThrow('request_timeout');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('does not make a late credential completion request after deadline', async () => {
    let resolve!: (token: string) => void;
    const slow = {
      token: () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    };
    const http = fixtureHttp();
    await expect(
      new PrivateGithubFetcher(configFixture(), slow, http, 10).fetch('private-canary'),
    ).rejects.toThrow('request_timeout');
    resolve('SYNTHETIC_SECRET_CANARY');
    await Promise.resolve();
    expect(http).not.toHaveBeenCalled();
  });
  it('rejects duplicate matches across pages before asset download', async () => {
    const http = fixtureHttp();
    http
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ id: 7 })))
      .mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse([assetFixture(), ...Array.from({ length: 99 }, () => ({ name: 'other' }))]),
        ),
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse([assetFixture()])));
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
    ).rejects.toThrow('asset_ambiguous');
    expect(http).toHaveBeenCalledTimes(3);
  });
  it('does not follow a second download redirect', async () => {
    const http = fixtureHttp(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://release-assets.githubusercontent.com/file' },
        }),
    );
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
    ).rejects.toThrow('request_failed');
    expect(http).toHaveBeenCalledTimes(4);
    expect(http.mock.calls[3]?.[1].headers).toBeUndefined();
  });
  it('uses one deadline across metadata and delayed pagination', async () => {
    const http = fixtureHttp();
    http
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(jsonResponse({ id: 7 })), 20)),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(jsonResponse([assetFixture()])), 20)),
      );
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http, 30).fetch('private-canary'),
    ).rejects.toThrow('request_timeout');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('cancels stalled redirected download bodies without forwarding the token', async () => {
    const cancel = vi.fn();
    const http = fixtureHttp();
    http
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ id: 7 })))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse([assetFixture()])))
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'https://release-assets.githubusercontent.com/file' },
          }),
        ),
      )
      .mockImplementationOnce(() => Promise.resolve(new Response(new ReadableStream({ cancel }))));
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http, 25).fetch('private-canary'),
    ).rejects.toThrow('request_timeout');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[3]?.[1].headers).toBeUndefined();
  });
  it('bounds decoded bytes without confusing compressed wire Content-Length', async () => {
    const http = fixtureHttp(
      () =>
        new Response(JSON.stringify(manifestFixture()), {
          headers: { 'content-encoding': 'gzip', 'content-length': '2' },
        }),
    );
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
    ).resolves.toEqual(manifestFixture());
  });
  it('rejects a non-byte response stream instead of coercing data', async () => {
    const http = fixtureHttp(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              // Deliberately violate the HTTP seam to prove runtime narrowing.
              controller.enqueue('not-bytes' as unknown as Uint8Array);
              controller.close();
            },
          }),
        ),
    );
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
    ).rejects.toThrow('response_invalid');
  });
  it('rejects a manifest with no signed rows', async () => {
    const http = fixtureHttp(() => jsonResponse({ ...manifestFixture(), rows: [] }));
    await expect(
      new PrivateGithubFetcher(configFixture(), credentials, http).fetch('private-canary'),
    ).rejects.toThrow('response_invalid');
  });
});
