#!/usr/bin/env node
/**
 * Generate the operator-internal J-Rig unified-report page.
 *
 * Usage (after `pnpm run build`):
 *
 *   pnpm run generate:eval-report -- /path/to/unified-report.json [site-internal]
 *
 * The input is a J-Rig local JSON projection, not a signed Evidence Bundle.
 * This command performs schema validation and writes only to the internal site
 * root. Passing a root named `site` is refused.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateUnifiedReportFiles,
  parseUnifiedReport,
  writeUnifiedReportSite,
} from '../dist/eval-reports/unified-report.js';

async function generate(reportPath: string, internalSiteRoot: string): Promise<string[]> {
  const raw = await readFile(reportPath, 'utf8');
  const report = parseUnifiedReport(JSON.parse(raw) as unknown);
  return writeUnifiedReportSite(generateUnifiedReportFiles(report), internalSiteRoot);
}

async function main(argv: readonly string[]): Promise<number> {
  const reportPath = argv[0];
  if (reportPath === undefined) {
    console.error('Usage: pnpm run generate:eval-report -- <unified-report.json> [site-internal]');
    return 2;
  }

  const requestedRoot = argv[1] ?? 'site-internal';

  let written: string[];
  try {
    written = await generate(
      resolve(process.cwd(), reportPath),
      resolve(process.cwd(), requestedRoot),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('public origin')) {
      console.error(`generate-eval-report: ${message}`);
      return 2;
    }
    throw error;
  }
  console.log(`✓ generated ${written.length} J-Rig unified report file(s)`);
  for (const path of written) console.log(`  ${path}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(
        'generate-eval-report crashed:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(2);
    });
}

export { generate, main };
