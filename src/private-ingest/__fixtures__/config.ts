import { parsePrivateConfig } from '../config.js';
export function configFixture() {
  return parsePrivateConfig({
    version: 1,
    issuer: 'https://token.actions.githubusercontent.com',
    sources: [
      {
        key: 'private-canary',
        githubRepo: 'fixture/private',
        release: { kind: 'tag', tag: 'v1' },
        asset: 'report-manifest.json',
        credentialRef: 'fixture-token',
        operatorConfirmed: true,
        subjects: ['repo:fixture/private:ref:refs/tags/*'],
        workflowRefs: ['fixture/private/.github/workflows/release.yml@refs/tags/*'],
      },
    ],
    credentials: [{ ref: 'fixture-token', repositories: ['fixture/private'] }],
    downloadHosts: ['release-assets.githubusercontent.com'],
  });
}
export const manifestFixture = () => ({
  repo: 'private-canary',
  signing: {
    issuer: 'https://token.actions.githubusercontent.com',
    subject: 'repo:fixture/private:ref:refs/tags/v1',
    workflowRef: 'fixture/private/.github/workflows/release.yml@refs/tags/v1',
  },
  rows: [{ bundle: {}, sigstoreBundle: {}, sourceSha: 'a'.repeat(40) }],
});
export const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value));
export const assetFixture = () => ({ id: 9, name: 'report-manifest.json', state: 'uploaded' });
