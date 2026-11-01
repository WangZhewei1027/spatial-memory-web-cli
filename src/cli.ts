#!/usr/bin/env node
import { run } from "./main.js";
import { CliError, HttpError } from "./errors.js";

run(process.argv.slice(2)).catch((error: unknown) => {
  const known = error instanceof CliError;
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(JSON.stringify({ error: message, ...(error instanceof HttpError ? { status: error.status } : {}), ...(known && error.details !== undefined ? { details: error.details } : {}) }) + "\n");
  process.exitCode = known ? error.exitCode : 1;
});
