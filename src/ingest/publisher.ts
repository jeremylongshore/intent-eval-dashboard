/**
 * Publisher supervision node (rest_for_one, downstream of renderer).
 *
 * The publisher takes the rendered output directory and pushes it to the
 * production origin (rsync to the Contabo VPS + `caddy reload`). That last hop
 * touches the production VPS, which is a HUMAN-GATED ops step per the VPS rules
 * (24 prod containers; `caddy validate` then `systemctl reload caddy`, never
 * restart). Therefore the real rsync+caddy hop is an INJECTED interface
 * ({@link PublisherTransport}); this repo ships only:
 *
 *   - the publisher NODE (supervision wiring + interface), and
 *   - a default transport that NO-OPS WITH LOGGING (see
 *     `publisher-transport-noop.ts`) — it does NOT claim to publish; it records
 *     that a publish WOULD have happened and returns. Anyone wiring real deploy
 *     supplies a transport that performs the gated rsync+caddy reload.
 *
 * This keeps the supervision tree complete + testable without ever touching
 * production from CI / tests.
 */

import { type RenderInput } from './renderer.js';

/** What the publisher pushes. */
export interface PublishRequest {
  /** The render input that produced the output (for provenance/logging). */
  readonly renderInput: RenderInput;
  /** Local path of the rendered output to publish. */
  readonly outputDir: string;
}

/** Result of a publish attempt. */
export interface PublishResult {
  readonly published: boolean;
  /** Human-readable note (e.g. "no-op default" or "rsync ok, caddy reloaded"). */
  readonly note: string;
}

/** The injected production hop (rsync + caddy reload). */
export interface PublisherTransport {
  publish(request: PublishRequest): Promise<PublishResult>;
}

/** A publisher node bound to a transport. */
export class Publisher {
  constructor(private readonly transport: PublisherTransport) {}

  publish(request: PublishRequest): Promise<PublishResult> {
    return this.transport.publish(request);
  }
}
