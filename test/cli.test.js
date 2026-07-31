import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "fortify.js");

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FORTIFY_HOME: path.join(tmpdir(), `fortify-cli-test-${process.pid}-${Date.now()}-${Math.random()}`),
      NO_COLOR: "1",
      ...env,
    },
  });
}

test("root help includes global flags and config command", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--json/);
  assert.match(result.stdout, /--verbose/);
  assert.match(result.stdout, /--quiet/);
  assert.match(result.stdout, /config/);
});

test("commit help includes dry-run flag", () => {
  const result = runCli(["commit", "--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--dry-run/);
});

test("config validate succeeds without an existing config file", () => {
  const result = runCli(["config", "validate"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Config is valid/);
});

test("config validate supports JSON output", () => {
  const result = runCli(["--json", "config", "validate"]);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, path: JSON.parse(result.stdout).path });
});
