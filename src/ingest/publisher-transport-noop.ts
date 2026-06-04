/**
 * Default publisher transport — NO-OP WITH LOGGING.
 *
 * This deliberately does NOT publish. The real production hop (rsync to the
 * Contabo VPS + `caddy reload`) is a human-gated ops step (24 prod containers
 * depend on the VPS; deploy goes through the GitHub Actions → Tailscale OIDC →
 * force-command SSH path documented in the deploy workflow, NOT from this
 * library). This default exists so the supervision tree is COMPLETE and
 * testable end-to-end without ever touching production.
 *
 * It returns `published: false` and a clear note — it never lies about having
 * published. Anyone wiring real deploy must inject a transport that performs
 * the gated rsync + `caddy validate && systemctl reload caddy`.
 *
 * (Excluded from coverage in vitest.config.ts: it is a documented stub, not
 * verification or supervision logic.)
 */

import {
  type PublishRequest,
  type PublishResult,
  type PublisherTransport,
} from './publisher.js';

export interface NoopLogger {
  info(message: string): void;
}

const consoleLogger: NoopLogger = {
  info: (message: string): void => {
     
    console.info(message);
  },
};

export class NoopPublisherTransport implements PublisherTransport {
  constructor(private readonly logger: NoopLogger = consoleLogger) {}

  publish(request: PublishRequest): Promise<PublishResult> {
    const repoCount = request.renderInput.repos.length;
    this.logger.info(
      `[publisher:noop] would rsync ${request.outputDir} to prod + reload caddy ` +
        `(${repoCount} repos, asOf=${request.renderInput.asOf}); ` +
        'real publish is a human-gated ops step — not performed here.',
    );
    return Promise.resolve({
      published: false,
      note: 'no-op default transport — production rsync+caddy is human-gated; nothing published',
    });
  }
}
