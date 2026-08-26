import assert from "node:assert/strict";
import test from "node:test";
import { CommandService } from "../src/services/command-service.js";
import { CommitService } from "../src/services/commit-service.js";
import { AuthService } from "../src/services/auth-service.js";
import { setRuntimeOptions, resetRuntimeOptions } from "../src/utils/runtime-options.js";
import { createTerminalUIStub } from "./helpers.js";

test("commit dry-run generates a message without executing git commit", async () => {
  const calls = { commit: 0 };
  const renderer = {
    showNotGitRepository() {},
    showNoStagedChanges() {},
    showContext() {},
    showDiffSummary() {},
    showGenerating() {},
    renderCommitMessageStream: async () => "feat: add dry run",
    showResolvedMessage() {},
    showDryRunComplete() {},
    showCommitSkipped() {},
    showError() {},
    askForConfirmation: async () => true,
  };
  const commitService = new CommitService({
    renderer,
    gitService: {
      isGitRepository: async () => true,
      getStagedDiff: async () => "diff --git a/a b/a",
      getStagedDiffSummary: async () => " a | 1 +",
      getCurrentBranchName: async () => "main",
      commitWithMessage: async () => {
        calls.commit += 1;
      },
    },
    openAIService: {
      streamResponse: async function* () {
        yield { type: "text_delta", delta: "feat: add dry run" };
      },
    },
    projectContextService: {
      getProjectContextSummary: async () => ({ name: "test-app", stack: ["Node.js"], instructions: "", git: null }),
      formatSystemPromptContext: () => "[Mock Project Context]",
      formatFullSystemPrompt: () => "[Mock Project Context]"
    }
  });

  const result = await commitService.runCommitFlow({ dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(calls.commit, 0);
});

test("noninteractive auth fails cleanly", async () => {
  const service = new AuthService({ terminalUI: createTerminalUIStub({ interactive: false }) });
  assert.equal(await service.authenticateOpenAIKey(), false);
});

test("CommandService emits JSON error output", async () => {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };
  process.exitCode = 0;
  setRuntimeOptions({ json: true });

  try {
    const service = new CommandService({
      commitService: {
        runCommitFlow: async () => ({ ok: false, reason: "no_staged_changes" }),
      },
    });

    await service.commit({});
    assert.equal(process.exitCode, 1);
    assert.deepEqual(JSON.parse(output), {
      ok: false,
      category: "no_staged_changes",
      code: "ERROR",
      message: "Unknown error.",
    });
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = 0;
    resetRuntimeOptions();
  }
});
