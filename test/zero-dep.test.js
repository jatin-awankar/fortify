import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAnsiStyle } from "../src/renderers/ansi-style.js";
import { NativeSpinner } from "../src/renderers/native-spinner.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package.json has 100% zero runtime third-party dependencies", () => {
  const pkgPath = path.join(root, "package.json");
  const pkgContent = JSON.parse(readFileSync(pkgPath, "utf8"));
  const deps = pkgContent.dependencies || {};
  assert.equal(Object.keys(deps).length, 0, "Expected 0 third-party runtime dependencies in package.json");
});

test("createAnsiStyle formats text natively using node:util styleText", () => {
  const style = createAnsiStyle({ forceColor: true });
  const formatted = style.cyan("Fortify");
  assert.ok(formatted.includes("Fortify"));
});

test("NativeSpinner handles start, stop, and succeed without external packages", () => {
  let output = "";
  const mockStdout = {
    isTTY: true,
    write(chunk) {
      output += chunk;
    }
  };

  const spinner = new NativeSpinner({
    text: "Analyzing...",
    stdout: mockStdout
  });

  spinner.start();
  assert.equal(spinner.isSpinning, true);
  spinner.succeed("Done!");
  assert.equal(spinner.isSpinning, false);
  assert.ok(output.includes("Done!"));
});
