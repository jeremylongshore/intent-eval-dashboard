/**
 * ntfy message formatter + injectable push transport (puxu.11).
 *
 * ── Two hard bindings this module enforces (DR-035 § 8) ──
 *
 *   (CFO) ntfy ONLY, NO PagerDuty. Alerts push to the `prod-alerts` topic on the
 *   tailnet-only ntfy server on the Contabo VPS. There is NO PagerDuty client,
 *   no Opsgenie, no Slack pager, no SMS gateway in this repo. The push is behind
 *   the `NtfyTransport` interface so a real HTTP POST can be injected later, but
 *   the only push *protocol* this module knows how to format is ntfy.
 *
 *   (default transport never lies) The default `NtfyTransport` is a
 *   NO-OP-THAT-LOGS — it returns `delivered: false` and a note, and NEVER claims
 *   a successful send. The real HTTP POST to the tailnet ntfy is a human-gated
 *   VPS ops step (the cron that runs `scripts/check-liveness-alerts.ts` lives on
 *   the VPS, where the tailnet ntfy address resolves). We never hardcode the VPS
 *   address into committed code — the base URL is supplied via config/env at the
 *   call site, defaulting to a documented placeholder that points at nothing.
 *
 * Mirrors the established "interface seam + no-op-that-logs default" pattern from
 * `src/ingest/publisher-transport-noop.ts` (the publisher rsync seam) and the
 * `RetractionSigner` default-unsigned seam — the production hop is always
 * human-gated; the default exists so the pipeline is COMPLETE and testable
 * end-to-end without ever touching production.
 */

import { type CriticalAlert, type AlertEvaluation } from './evaluate.js';

/** The ntfy topic critical liveness pages publish to (CFO binding). */
export const NTFY_TOPIC = 'prod-alerts';

/**
 * Documented placeholder base URL. The REAL value is the tailnet-only ntfy on
 * the VPS (per the global ops posture, `http://intentsolutions:8080` on the
 * tailnet) and is supplied via config/env at the call site — NEVER hardcoded
 * into committed code. This placeholder resolves to nothing on purpose: it makes
 * a forgotten-config push fail visibly rather than silently hit a real host.
 */
export const NTFY_BASE_URL_PLACEHOLDER = 'http://ntfy.invalid';

/** ntfy priority levels. Critical liveness pages are always `5` (max/urgent). */
export type NtfyPriority = 1 | 2 | 3 | 4 | 5;

/** Public /status URL the page body links to (public, no-auth — DR-035 C4). */
export const STATUS_URL = 'https://labs.intentsolutions.io/status/';

/** A formatted ntfy message ready to POST (transport-agnostic). */
export interface NtfyMessage {
  /** The topic to publish to. Always {@link NTFY_TOPIC} for liveness pages. */
  readonly topic: string;
  /** ntfy priority. Critical liveness pages are `5`. */
  readonly priority: NtfyPriority;
  /** Short title line. */
  readonly title: string;
  /** Body — names the silent source(s), days-silent, and links to /status. */
  readonly body: string;
  /** ntfy tags (rendered as emoji/labels). `rotating_light` for criticals. */
  readonly tags: readonly string[];
  /** A click-through URL header — the public /status page. */
  readonly clickUrl: string;
}

/** The outcome of an attempted push. */
export interface NtfyPushResult {
  /**
   * Whether the message was actually delivered. The DEFAULT transport ALWAYS
   * returns `false` — it never claims a send it did not perform.
   */
  readonly delivered: boolean;
  /** Human-readable note (e.g. "no-op default — real push is human-gated"). */
  readonly note: string;
}

/**
 * The push seam. A real implementation does an HTTP POST to the tailnet ntfy on
 * the VPS; the default is a no-op-that-logs. Injecting a real transport is a
 * human-gated VPS ops step.
 */
export interface NtfyTransport {
  push(message: NtfyMessage): Promise<NtfyPushResult>;
}

/** A minimal logger the no-op transport writes to (console by default). */
export interface NtfyLogger {
  info(message: string): void;
}

const consoleLogger: NtfyLogger = {
  info: (message: string): void => {
    console.info(message);
  },
};

/**
 * Whole-days-silent as a human string. `Infinity` (never seen) renders as
 * "never seen" rather than a bogus number.
 */
function daysSilentLabel(alert: CriticalAlert): string {
  if (!Number.isFinite(alert.daysSilent)) return 'never seen (no verified ingest, ever)';
  const d = alert.daysSilent;
  return `${d} day${d === 1 ? '' : 's'} silent`;
}

/**
 * Format the single critical ntfy message for an evaluation that has at least
 * one silent source. Names every silent source with its days-silent, sets
 * priority 5, topic `prod-alerts`, and links to the PUBLIC /status page.
 *
 * Caller MUST only invoke this when `evaluation.critical.length > 0` — a page
 * with no silent source would be a false page (forbidden: 7d-silence is the ONLY
 * trigger). `formatCriticalMessage` THROWS on an empty critical list to make
 * that misuse impossible to ship silently.
 */
export function formatCriticalMessage(evaluation: AlertEvaluation): NtfyMessage {
  if (evaluation.critical.length === 0) {
    throw new Error(
      'formatCriticalMessage called with zero critical alerts — 7d-silence is the ONLY paging trigger; never page on an empty list',
    );
  }
  const n = evaluation.critical.length;

  const title =
    n === 1
      ? `IEP dashboard: source ${evaluation.critical[0]?.repo ?? ''} silent > 7 days`
      : `IEP dashboard: ${n} sources silent > 7 days`;

  const lines = [
    `${n} source${n === 1 ? '' : 's'} have published NO verified, signed Evidence Bundle in over 7 days:`,
    '',
    ...evaluation.critical.map((a) => {
      const last =
        a.lastSuccessfulIngestIso !== undefined
          ? `last successful ingest ${a.lastSuccessfulIngestIso}`
          : 'no successful ingest on record';
      return `  • ${a.repo} — ${daysSilentLabel(a)} (${last})`;
    }),
    '',
    '7-day-silence is the only condition that pages. Check liveness:',
    STATUS_URL,
  ];

  return {
    topic: NTFY_TOPIC,
    priority: 5,
    title,
    body: lines.join('\n'),
    tags: ['rotating_light', 'iep-liveness'],
    clickUrl: STATUS_URL,
  };
}

/**
 * The DEFAULT ntfy transport: NO-OP-THAT-LOGS.
 *
 * It logs what it WOULD push and returns `delivered: false`. It never performs
 * an HTTP request, never hardcodes the VPS address, and NEVER claims a
 * successful delivery. The real push is a human-gated VPS ops step — the cron
 * that runs the alert check lives on the VPS where the tailnet ntfy resolves,
 * and injects a real transport there.
 *
 * (Excluded from coverage in vitest.config.ts: a documented stub, not paging
 * logic — same treatment as `src/ingest/publisher-transport-noop.ts`.)
 */
export class NoopNtfyTransport implements NtfyTransport {
  constructor(private readonly logger: NtfyLogger = consoleLogger) {}

  push(message: NtfyMessage): Promise<NtfyPushResult> {
    this.logger.info(
      `[ntfy:noop] would POST to topic '${message.topic}' (priority ${message.priority}): ` +
        `${message.title}. Real push is a human-gated VPS ops step (tailnet ntfy) — ` +
        'nothing delivered.',
    );
    return Promise.resolve({
      delivered: false,
      note: 'no-op default transport — real ntfy push is human-gated on the VPS; nothing delivered',
    });
  }
}
