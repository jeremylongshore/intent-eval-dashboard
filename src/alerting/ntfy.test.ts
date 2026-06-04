/**
 * ntfy formatter + transport tests (puxu.11).
 *
 * Proves: the critical payload uses priority 5, the correct topic
 * (`prod-alerts`), names the source(s) + days-silent, and links to the PUBLIC
 * /status page; the default transport NEVER claims a successful send; and the
 * formatter refuses to build a message for an empty critical list (7d-silence is
 * the only trigger — never page on nothing).
 */

import { describe, expect, it } from 'vitest';
import { type AlertEvaluation } from './evaluate.js';
import {
  formatCriticalMessage,
  NoopNtfyTransport,
  NTFY_TOPIC,
  STATUS_URL,
  type NtfyLogger,
} from './ntfy.js';

const NOW = '2026-06-04T12:00:00.000Z';

const oneSilent: AlertEvaluation = {
  nowIso: NOW,
  critical: [
    {
      repo: 'iaj',
      lastSuccessfulIngestIso: '2026-05-25T11:00:00.000Z',
      daysSilent: 10,
      silentMs: 10 * 24 * 60 * 60 * 1000,
    },
  ],
};

const twoSilent: AlertEvaluation = {
  nowIso: NOW,
  critical: [
    { repo: 'iar', daysSilent: Number.POSITIVE_INFINITY, silentMs: Number.POSITIVE_INFINITY },
    {
      repo: 'iaj',
      lastSuccessfulIngestIso: '2026-05-25T11:00:00.000Z',
      daysSilent: 10,
      silentMs: 10 * 24 * 60 * 60 * 1000,
    },
  ],
};

describe('formatCriticalMessage — payload shape (CFO ntfy binding)', () => {
  it('uses critical priority 5 and the prod-alerts topic', () => {
    const msg = formatCriticalMessage(oneSilent);
    expect(msg.priority).toBe(5);
    expect(msg.topic).toBe('prod-alerts');
    expect(msg.topic).toBe(NTFY_TOPIC);
  });

  it('names the silent source and its days-silent in title + body', () => {
    const msg = formatCriticalMessage(oneSilent);
    expect(msg.title).toContain('iaj');
    expect(msg.body).toContain('iaj');
    expect(msg.body).toContain('10 days silent');
    expect(msg.body).toContain('last successful ingest 2026-05-25T11:00:00.000Z');
  });

  it('links to the PUBLIC /status page (no-auth liveness) in body + clickUrl', () => {
    const msg = formatCriticalMessage(oneSilent);
    expect(msg.clickUrl).toBe(STATUS_URL);
    expect(msg.clickUrl).toBe('https://labs.intentsolutions.io/status/');
    expect(msg.body).toContain(STATUS_URL);
  });

  it('renders a never-seen source honestly (not a bogus number)', () => {
    const msg = formatCriticalMessage(twoSilent);
    expect(msg.title).toContain('2 sources');
    expect(msg.body).toContain('iar');
    expect(msg.body).toContain('never seen');
    expect(msg.body).toContain('no successful ingest on record');
  });

  it('tags the message as a critical liveness page', () => {
    const msg = formatCriticalMessage(oneSilent);
    expect(msg.tags).toContain('rotating_light');
    expect(msg.tags).toContain('iep-liveness');
  });

  it('THROWS on an empty critical list — never page on nothing (only-trigger guard)', () => {
    const empty: AlertEvaluation = { nowIso: NOW, critical: [] };
    expect(() => formatCriticalMessage(empty)).toThrow(/only paging trigger|zero critical/i);
  });
});

describe('NoopNtfyTransport — default never claims a successful send', () => {
  it('returns delivered:false with a clear note and DOES NOT fake a push', async () => {
    const logged: string[] = [];
    const logger: NtfyLogger = { info: (m) => logged.push(m) };
    const transport = new NoopNtfyTransport(logger);

    const msg = formatCriticalMessage(oneSilent);
    const result = await transport.push(msg);

    expect(result.delivered).toBe(false);
    expect(result.note).toMatch(/no-op|human-gated|nothing delivered/i);
    // It logged what it WOULD push, including the topic + priority.
    expect(logged.join('\n')).toContain("topic 'prod-alerts'");
    expect(logged.join('\n')).toContain('priority 5');
    // And it is explicit that nothing was actually delivered.
    expect(logged.join('\n')).toMatch(/nothing delivered/i);
  });
});
