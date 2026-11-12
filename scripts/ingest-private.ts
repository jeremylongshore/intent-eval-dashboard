#!/usr/bin/env node
// Separate opt-in command: never invoked by public regeneration/deploy workflows.
import { privateCli } from '../dist/private-ingest/run.js';
const result = await privateCli(process.argv.slice(2));
console.log(JSON.stringify(result.report));
process.exitCode = result.exitCode;
