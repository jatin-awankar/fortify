import assert from "node:assert/strict";
import test from "node:test";
import { CommitService } from "../src/services/commit-service.js";

function createMockCommitService({
  stagedDiff = "diff --git a/file b/file",
  generatedMsg = "feat: initial commit",
  editedMsg = null,
  editorExitCode = 0,
  config = {}
} = {}) {
  let writtenTempContent = "";
  let unlinkedTempFile = null;
  let spawnedCmd = null;

  const mockFs = {
    writeFile: async (filePath, data) => {
      writtenTempContent = data;
    },
    readFile: async () => {
      return editedMsg !== null ? editedMsg : writtenTempContent;
    },
    unlink: async (filePath) => {
      unlinkedTempFile = filePath;
    }
  };

  const mockChildSpawner = (bin, args) => {
    spawnedCmd = `${bin} ${args.join(" ")}`;
    return {
      on: (event, cb) => {
        if (event === "close") {
          cb(editorExitCode);
        }
      }
    };
  };

  const renderer = {
    showNotGitRepository() {},
    showNoStagedChanges() {},
    showContext() {},
    showDiffSummary() {},
    showGenerating() {},
    renderCommitMessageStream: async () => generatedMsg,
    showResolvedMessage() {},
    showDryRunComplete() {},
    showCommitSkipped() {},
    showCommitExecuted() {},
    showError() {},
    showWarning() {},
    askForConfirmation: async () => true,
    terminalUI: { info() {} }
  };

  const service = new CommitService({
    gitService: {
      isGitRepository: async () => true,
      getStagedDiff: async () => stagedDiff,
      getStagedDiffSummary: async () => "file | 1 +",
      getCurrentBranchName: async () => "main",
      commitWithMessage: async ({ message }) => ({ output: `committed: ${message}` })
    },
    openAIService: {
      streamResponse: async function* () {
        yield { type: "text_delta", delta: generatedMsg };
      }
    },
    projectContextService: {
      getProjectContextSummary: async () => ({ name: "app", stack: ["Node.js"], instructions: "", git: null }),
      formatSystemPromptContext: () => "[Context]"
    },
    configLoader: async () => config,
    fsPromises: mockFs,
    childSpawner: mockChildSpawner,
    renderer
  });

  return {
    service,
    getWrittenTempContent: () => writtenTempContent,
    getUnlinkedTempFile: () => unlinkedTempFile,
    getSpawnedCmd: () => spawnedCmd
  };
}

test("CommitService runCommitFlow supports interactive editor editing", async () => {
  const { service, getWrittenTempContent, getSpawnedCmd } = createMockCommitService({
    generatedMsg: "feat: initial draft",
    editedMsg: "feat(scope): user fine-tuned message",
    config: { editor: "code --wait" }
  });

  const result = await service.runCommitFlow({ interactive: true, autoCommit: true });
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.message, "feat(scope): user fine-tuned message");
  assert.equal(getWrittenTempContent(), "feat: initial draft");
  assert.match(getSpawnedCmd(), /code --wait/);
});

test("CommitService runCommitFlow rejects invalid message when validate is true", async () => {
  const { service } = createMockCommitService({
    generatedMsg: "bad commit message without conventional type"
  });

  const result = await service.runCommitFlow({ validate: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_commit_format");
});

test("CommitService runCommitFlow accepts valid conventional commit when validate is true", async () => {
  const { service } = createMockCommitService({
    generatedMsg: "fix(core): resolve race condition in worker loop"
  });

  const result = await service.runCommitFlow({ validate: true, autoCommit: true });
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.message, "fix(core): resolve race condition in worker loop");
});
