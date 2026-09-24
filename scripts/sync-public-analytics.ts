/** Restore domain-scoped trackers after public HTML generation; never touch site-internal. */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function sync(directory: string, domain: string, websiteId: string): number {
  let changed = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      changed += sync(path, domain, websiteId);
    } else if (entry.name.endsWith('.html')) {
      const original = readFileSync(path, 'utf8');
      if (original.includes('https://analytics.intentsolutions.io/script.js')) continue;
      if (!original.includes('</head>')) throw new Error(`Missing head: ${path}`);
      const script = `<script defer src="https://analytics.intentsolutions.io/script.js" data-website-id="${websiteId}" data-domains="${domain}"></script>`;
      writeFileSync(path, original.replace('</head>', `${script}\n</head>`));
      changed += 1;
    }
  }
  return changed;
}

console.log(
  'Public analytics pages updated:',
  sync('site', 'labs.intentsolutions.io', '3109d0c5-2681-4808-a673-817af56ebc09'),
  sync('site-evals', 'evals.intentsolutions.io', '8faaad49-4e88-4f8e-8a48-88ba194bcfb6'),
);
