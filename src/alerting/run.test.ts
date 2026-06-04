/**
 * Alert-pass orchestrator tests (puxu.11).
 *
 * Proves the evaluate → format → push wiring: a silent>7d source results in
 * exactly one push of a correctly-shaped message; a fresh/erroring source
 * results in NO push at all (the only-trigger binding, end to end through the
 * orchestrator); and the summary reflects the (no-op) transport's honesty.
 */

import { describe, expect, it } from 'vitest';
import { SEVEN_DAYS_MS, type SourceLiveness } from './evaluate.js';
import { type NtfyMessage, type NtfyPushResult, type NtfyTransport } from './ntfy.js';
import { runAlertPass } from './run.js';

const NOW = '2026-06-04T12:00:00.000Z';
const nowMs = Date.parse(NOW);
const HOUR = 60 * 60 * 1000;
const at = (msBefore: number): string => new Date(nowMs - msBefore).toISOString();

/** A transport that RECORDS what it was asked to push (and never lies). */
class RecordingTransport implements NtfyTransport {
  readonly pushes: NtfyMessage[] = [];
  constructor(private readonly delivered = false) {}
  push(message: NtfyMessage): Promise<NtfyPushResult> {
    this.pushes.push(message);
    return Promise.resolve({
      delivered: this.delivered,
      note: this.delivered ? 'recorded (test)' : 'recorded (test) — not delivered',
    });
  }
}

describe('runAlertPass — evaluate → format → push wiring', () => {
  it('pushes exactly one critical message when a source is silent > 7 days', async () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iaj', lastSuccessfulIngestIso: at(SEVEN_DAYS_MS + HOUR) },
    ];
    const transport = new RecordingTransport();
    const summary = await runAlertPass(liveness, NOW, transport);

    expect(summary.critical).toBe(1);
    expect(transport.pushes).toHaveLength(1);
    expect(transport.pushes[0]?.topic).toBe('prod-alerts');
    expect(transport.pushes[0]?.priority).toBe(5);
    expect(transport.pushes[0]?.body).toContain('iaj');
    // The no-op-style transport did not claim delivery.
    expect(summary.delivered).toBe(false);
  });

  it('does NOT push at all when every source is within 7 days (only-trigger, end to end)', async () => {
    const liveness: SourceLiveness[] = [
      { repo: 'iec', lastSuccessfulIngestIso: at(HOUR) }, // fresh
      {
        repo: 'iah',
        lastSuccessfulIngestIso: at(2 * HOUR),
        currentError: { step: 'verify-dsse', reasonCode: 'DSSE_BAD_SIG' },
      }, // fresh + erroring
      { repo: 'iel', lastSuccessfulIngestIso: at(6 * 24 * HOUR) }, // 6d
    ];
    const transport = new RecordingTransport();
    const summary = await runAlertPass(liveness, NOW, transport);

    expect(summary.critical).toBe(0);
    expect(transport.pushes).toHaveLength(0); // nothing pushed
    expect(summary.delivered).toBe(false);
    expect(summary.note).toMatch(/nothing to page/i);
  });

  it('reports delivered:true only if the transport actually delivered', async () => {
    const liveness: SourceLiveness[] = [{ repo: 'iar' }]; // never seen
    const transport = new RecordingTransport(true);
    const summary = await runAlertPass(liveness, NOW, transport);
    expect(summary.critical).toBe(1);
    expect(summary.delivered).toBe(true);
  });
});
