#!/usr/bin/env node

import { runCli } from "../src/index.js";
import { USER_CANCELLED_EXIT_CODE } from "../src/utils/operation-cancellation.js";
import { normalizeErrorForOutput } from "../src/utils/error-normalizer.js";
import { getRuntimeOptions } from "../src/utils/runtime-options.js";

function isSigintLikeError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (
    error.name === "AbortError" ||
    error.code === "ABORT_ERR" ||
    error.code === "STREAM_RENDER_CANCELLED"
  );
}

async function main() {
  await runCli(process.argv);
}

main().catch((error) => {
  if (isSigintLikeError(error)) {
    process.exitCode = USER_CANCELLED_EXIT_CODE;
    return;
  }

  const runtimeOptions = getRuntimeOptions();

  if (runtimeOptions.json) {
    process.stdout.write(`${JSON.stringify(normalizeErrorForOutput(error, "error", {
      verbose: runtimeOptions.verbose,
    }))}\n`);
  } else {
    const message = runtimeOptions.verbose && error instanceof Error && error.stack
      ? error.stack
      : error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
  }

  process.exitCode = process.exitCode || 1;
});
