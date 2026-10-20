#!/usr/bin/env node
import { main } from './cli-main.js';

main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  stdoutIsTTY: Boolean(process.stdout.isTTY),
  stderrIsTTY: Boolean(process.stderr.isTTY),
  columns: process.stdout.columns,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`site-audit: ${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = 2;
  },
);
