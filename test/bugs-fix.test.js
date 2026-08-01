import test from "node:test";
import assert from "node:assert/strict";
import { parseAndRunNativeCli } from "../src/commands/native-cli-parser.js";
import { LocalHistoryStore } from "../src/storage/local-history-store.js";
import { GitService } from "../src/services/git-service.js";
import { collectProjectTextFiles } from "../src/utils/project-files.js";
import { createTerminalUI } from "../src/renderers/terminal-ui.js";
import { loadRuntimeConfig } from "../src/config/local-config.js";
import { chunkText } from "../src/utils/text-chunker.js";
import { ProviderFactory } from "../src/services/provider-factory.js";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("Bug 1 & 10: native CLI parser supports flags before positionals and history --clear", async () => {
  let calledCommand = "";
  let calledOptions = {};

  const mockCommandService = {
    history: async (opts) => {
      calledCommand = "history";
      calledOptions = opts;
    },
    summarize: async (opts) => {
      calledCommand = "summarize";
      calledOptions = opts;
    }
  };

  // Test history --clear
  await parseAndRunNativeCli(["node", "fortify", "history", "--clear"], mockCommandService);
  assert.equal(calledCommand, "history");
  assert.equal(calledOptions.clear, true);
  assert.equal(calledOptions.show, "");

  // Test flags before positional (fortify summarize --format json .)
  await parseAndRunNativeCli(["node", "fortify", "summarize", "--format", "json", "."], mockCommandService);
  assert.equal(calledCommand, "summarize");
  assert.equal(calledOptions.source, ".");
  assert.equal(calledOptions.format, "json");
});

test("Bug 2: LocalHistoryStore listSessions skips corrupted files safely", async () => {
  const tmpDir = path.join(os.tmpdir(), `fortify_test_history_${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const validFile = path.join(tmpDir, "valid.json");
    const corruptFile = path.join(tmpDir, "corrupt.json");

    await writeFile(validFile, JSON.stringify({ id: "valid", messages: [{ role: "user", content: "hello" }] }));
    await writeFile(corruptFile, "{ invalid json content... ");

    const store = new LocalHistoryStore({ baseDirectory: tmpDir });
    const sessions = await store.listSessions();

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "valid");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("Bug 7: collectProjectTextFiles ignores .next, .fortify, and build directories", async () => {
  const tmpDir = path.join(os.tmpdir(), `fortify_test_proj_${Date.now()}`);
  await mkdir(path.join(tmpDir, ".next", "static"), { recursive: true });
  await mkdir(path.join(tmpDir, "src"), { recursive: true });

  try {
    await writeFile(path.join(tmpDir, ".next", "static", "chunk.js"), "console.log('built');");
    await writeFile(path.join(tmpDir, "src", "index.js"), "console.log('source');");

    const files = await collectProjectTextFiles(tmpDir);
    assert.equal(files.length, 1);
    assert.ok(files[0].includes("index.js"));
    assert.ok(!files[0].includes(".next"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("Bug 9: GitService getRecentCommits handles exit code 128 (0 commits) without throwing", async () => {
  const gitService = new GitService({
    commandRunner: async (args) => {
      if (args[0] === "rev-parse") {
        return { ok: true, exitCode: 0, stdout: "true" };
      }
      if (args[0] === "log") {
        return { ok: false, exitCode: 128, stdout: "", stderr: "fatal: your current branch 'main' does not have any commits yet" };
      }
      return { ok: false, exitCode: 1 };
    }
  });

  const commits = await gitService.getRecentCommits();
  assert.deepEqual(commits, []);
});

test("Bug 14: TerminalUI createSpinner uses NativeSpinner without throwing ReferenceError", () => {
  const ui = createTerminalUI();
  const spinner = ui.createSpinner("Testing spinner");
  assert.ok(spinner);
  assert.equal(typeof spinner.start, "function");
  assert.equal(typeof spinner.stop, "function");
});

test("Bug 15: loadRuntimeConfig loads GEMINI_API_KEY and ANTHROPIC_API_KEY from env", async () => {
  const config = await loadRuntimeConfig({
    env: {
      GEMINI_API_KEY: "gemini-secret-key",
      ANTHROPIC_API_KEY: "anthropic-secret-key"
    }
  });
  assert.equal(config.apiKeys.gemini, "gemini-secret-key");
  assert.equal(config.apiKeys.anthropic, "anthropic-secret-key");
});

test("Bug 16: chunkText clamps safeOverlap to prevent micro-stepping loops", () => {
  const text = "A".repeat(1000);
  const chunks = chunkText(text, { chunkSize: 100, overlap: 100 });
  assert.ok(chunks.length <= 25);
});

test("Bug 17: ProviderFactory throws descriptive error on unsupported explicit provider", async () => {
  const factory = new ProviderFactory();
  await assert.rejects(
    async () => factory.getProvider("unsupported_provider_xyz"),
    /Unsupported provider 'unsupported_provider_xyz'/
  );
});
