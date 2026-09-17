import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_HEADER } from './results/render-html.js';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const publicPages = [
  'index.html',
  'start/index.html',
  'how-it-works/index.html',
  'examples/index.html',
  'eval-sets/index.html',
  'methodology/index.html',
];

describe('plain-language public journey', () => {
  it('leads with business decisions, broad scope and a usable next step', () => {
    const home = read('site/index.html');
    const front = home.split('<!-- FRESHNESS-STRIP:START')[0] ?? '';
    for (const text of [
      'what to fund, fix or stop',
      'agent',
      'loops',
      'skills',
      'workflows',
      'cost',
      'human',
    ]) {
      expect(front.toLowerCase()).toContain(text);
    }
    expect(front).toContain('href="/start/"');
    expect(front).toContain('href="/examples/"');
  });

  it('uses one navigation across public pages and retains all network destinations', () => {
    const check = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) check(path);
        else if (entry.name.endsWith('.html')) {
          const html = readFileSync(path, 'utf8');
          expect(/<header class="site-header">[\s\S]*?<\/header>/.exec(html)?.[0], path).toBe(
            SITE_HEADER.trim(),
          );
        }
      }
    };
    check(join(process.cwd(), 'site'));
    for (const domain of ['demos', 'learn', 'evals']) {
      expect(SITE_HEADER).toContain(`https://${domain}.intentsolutions.io/`);
    }
  });

  it('keeps local visitor paths valid, including technical anchors', () => {
    for (const page of publicPages) {
      for (const match of read(`site/${page}`).matchAll(/href="(\/[^"]*)"/g)) {
        const [path = '', anchor] = (match[1] ?? '').split('#');
        const target = join('site', path.endsWith('/') ? `${path}index.html` : path);
        expect(existsSync(target), `${page}: ${match[1]}`).toBe(true);
        if (anchor) expect(read(target)).toContain(`id="${anchor}"`);
      }
    }
  });

  it('distinguishes the available tools from pending workflow integration', () => {
    const method = read('site/methodology/index.html');
    expect(method).toContain('248');
    expect(method).toContain('249');
    expect(method).toContain('opt-in');
    expect(read('site/how-it-works/index.html')).toContain('not an ROI guarantee');
    expect(read('site/start/index.html')).toContain('not a file-upload service');
  });

  it('keeps registry maturity separate from test outcomes', () => {
    const registry = read('site-evals/index.html');
    expect(registry).toContain('not whether a system passed its tests');
    for (const state of ['NORMATIVE', 'DRAFT', 'RESERVED']) expect(registry).toContain(state);
    expect(registry).toContain('https://labs.intentsolutions.io/how-it-works/');
  });
});
