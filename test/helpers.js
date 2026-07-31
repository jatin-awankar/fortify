import { PassThrough } from "node:stream";

export function createTerminalUIStub({ interactive = false } = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.columns = 80;
  stderr.columns = 80;

  const terminalUI = {
    stdin: new PassThrough(),
    stdout,
    stderr,
    chalk: {
      dim: (value) => String(value),
      bold: {
        cyan: (value) => String(value),
        green: (value) => String(value),
      },
    },
    capabilities: {
      isInteractive: interactive,
      shouldUseSpinner: false,
      shouldUseColor: false,
    },
    success(message) {
      stdout.write(`[SUCCESS] ${message}\n`);
    },
    error(message) {
      stderr.write(`[ERROR] ${message}\n`);
    },
    warning(message) {
      stderr.write(`[WARNING] ${message}\n`);
    },
    info(message) {
      stdout.write(`[INFO] ${message}\n`);
    },
    divider(label = "") {
      stdout.write(`---${label}---\n`);
    },
    createSpinner() {
      return { start() {}, stop() {}, succeed() {}, fail() {} };
    },
  };

  return terminalUI;
}
