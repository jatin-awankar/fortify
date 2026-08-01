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
  const isVerbose = Boolean(runtimeOptions.verbose || process.argv.includes("--verbose"));
  const isJson = Boolean(runtimeOptions.json || process.argv.includes("--json"));

  if (isJson) {
    process.stdout.write(`${JSON.stringify(normalizeErrorForOutput(error, "error", {
      verbose: isVerbose,
    }))}\n`);
  } else {
    const message = isVerbose && error instanceof Error && error.stack
      ? error.stack
      : error instanceof Error ? error.message : String(error ?? "Unknown error occurred.");
    process.stderr.write(`${message}\n`);
  }

  if (typeof process.exitCode !== "number") {
    process.exitCode = 1;
  }
});
