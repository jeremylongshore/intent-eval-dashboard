/**
 * Apply the shared public header to static reports without regenerating evidence.
 * Historical result data, timestamps and evidence links stay intact.
 * A scroll region contains wide result tables on touch screens and for keyboard users.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_HEADER } from '../dist/results/render-html.js';

function sync(directory: string): number {
  let changed = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      changed += sync(path);
    } else if (entry.name.endsWith('.html')) {
      const original = readFileSync(path, 'utf8');
      let updated = original.replace(
        /<header class="site-header">[\s\S]*?<\/header>/,
        SITE_HEADER.trim(),
      );
      updated = updated.replace(
        /<table class="results-table">[\s\S]*?<\/table>/g,
        (table, offset: number) => {
          if (
            updated
              .slice(Math.max(0, offset - 160), offset)
              .includes('aria-label="Detailed test results"')
          ) {
            return table;
          }
          return `<div class="table-scroll" role="region" aria-label="Detailed test results" tabindex="0">${table}</div>`;
        },
      );
      if (updated !== original) {
        writeFileSync(path, updated);
        changed += 1;
      }
    }
  }
  return changed;
}

console.log(
  `Updated public navigation and table layout on ${sync('site')} pages; result data unchanged.`,
);
