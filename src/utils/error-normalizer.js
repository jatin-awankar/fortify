const ERROR_CATEGORIES = new Map([
  ["OPENAI_CONFIGURATION_ERROR", "missing_api_key"],
  ["OPENAI_REQUEST_ERROR", "openai_failure"],
  ["OPENAI_TIMEOUT_ERROR", "openai_failure"],
  ["GIT_BINARY_NOT_FOUND", "git_failure"],
  ["GIT_SERVICE_ERROR", "git_failure"],
  ["GIT_INVALID_COMMIT_MESSAGE", "git_failure"],
  ["GIT_NOT_REPOSITORY", "not_git_repo"],
  ["GIT_COMMIT_FAILED", "git_failure"],
  ["INVALID_CONFIG", "invalid_config"],
  ["EMPTY_INPUT", "empty_input"],
]);

export function normalizeErrorForOutput(error, fallbackCategory = "error", { verbose = false } = {}) {
  const code = typeof error?.code === "string" ? error.code : undefined;
  const category = code && ERROR_CATEGORIES.has(code)
    ? ERROR_CATEGORIES.get(code)
    : fallbackCategory;

  const output = {
    ok: false,
    category,
    code: code ?? "ERROR",
    message: error instanceof Error ? error.message : (error?.message ? String(error.message) : String(error ?? "Unknown error.")),
  };

  if (verbose && error instanceof Error && error.stack) {
    output.stack = error.stack;
  }

  return output;
}
