import { describe, expect, it } from 'vitest';
import { parsePrivateConfig, privatePins } from './config.js';
import { configFixture } from './__fixtures__/config.js';
describe('private operator enrollment', () => {
  it('derives confirmed private pins for config-only onboarding', () => {
    const config = configFixture();
    expect(privatePins(config).repos['private-canary']?.githubRepo).toBe('fixture/private');
  });
  it.each(['key', 'githubRepo', 'asset', 'credentialRef'])(
    'rejects terminal newline in %s',
    (field) => {
      const config = configFixture();
      const raw = config.sources[0]! as unknown as Record<string, unknown>;
      raw[field] = `${String(raw[field])}\n`;
      expect(() => parsePrivateConfig(config)).toThrow('configuration_invalid');
    },
  );
  it.each([
    'unconfirmed',
    'duplicate-source',
    'duplicate-credential',
    'unbound',
    'subject',
    'workflow',
    'unknown',
    'host',
    'tag',
  ])('rejects invalid enrollment %s', (mode) => {
    const config = configFixture();
    const first = config.sources[0]!;
    const raw = first as unknown as Record<string, unknown>;
    if (mode === 'unconfirmed') raw['operatorConfirmed'] = false;
    if (mode === 'duplicate-source') config.sources.push(first);
    if (mode === 'duplicate-credential') config.credentials.push(config.credentials[0]!);
    if (mode === 'unbound') config.credentials[0]!.repositories = ['other/repo'];
    if (mode === 'subject') first.subjects = ['repo:evil/repo:*'];
    if (mode === 'workflow') first.workflowRefs = ['evil/repo/*'];
    if (mode === 'unknown') raw['token'] = 'SYNTHETIC_SECRET';
    if (mode === 'host') config.downloadHosts = ['release-assets.githubusercontent.com\n'];
    if (mode === 'tag') first.release = { kind: 'tag', tag: 'v1\n' };
    expect(() => parsePrivateConfig(config)).toThrow(/^configuration_invalid$/u);
  });
});
