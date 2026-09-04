import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { GitCheckpointService, CHECKPOINT_PREFIX, DEFAULT_LABEL } from "../src/services/git-checkpoint-service.js";

/**
 * Create a mock GitService with a commandRunner that returns predefined responses.
 * @param {object} responses - Map of command pattern → response
 */
function createMockGitService(responses = {}) {
  const calls = [];

  const commandRunner = async (args, { cwd } = {}) => {
    calls.push({ args, cwd });
    const key = args.join(" ");

    // Check for exact match first, then prefix match
    if (responses[key]) {
      return typeof responses[key] === "function" ? responses[key]() : responses[key];
    }

    // Check prefix matches
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.startsWith(pattern)) {
        return typeof response === "function" ? response() : response;
      }
    }

    // Default: success with empty output
    return { ok: true, stdout: "", stderr: "", exitCode: 0 };
  };

  return {
    gitService: {
      commandRunner,
      isGitRepository: async () => true,
    },
    calls,
    commandRunner,
  };
}

describe("GitCheckpointService", () => {
  describe("constructor", () => {
    it("should accept custom gitService and cwd", () => {
      const mockGit = { commandRunner: () => {}, isGitRepository: async () => true };
      const service = new GitCheckpointService({ gitService: mockGit, cwd: "/my/project" });
      assert.equal(service.cwd, "/my/project");
      assert.equal(service.gitService, mockGit);
    });

    it("should use default cwd when not provided", () => {
      const mockGit = { commandRunner: () => {}, isGitRepository: async () => true };
      const service = new GitCheckpointService({ gitService: mockGit });
      assert.equal(typeof service.cwd, "string");
    });
  });

  describe("createCheckpoint", () => {
    it("should create a checkpoint with default label", async () => {
      const { gitService, calls } = createMockGitService({
        "status --porcelain": { ok: true, stdout: " M file.js\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.createCheckpoint({
        date: new Date("2026-08-27T16:30:00"),
      });

      assert.equal(result.created, true);
      assert.ok(result.message.startsWith(CHECKPOINT_PREFIX));
      assert.ok(result.message.includes("2026-08-27T16:30:00"));
      assert.ok(result.message.endsWith("/pre-edit"));
      assert.equal(result.timestamp, "2026-08-27T16:30:00");
    });

    it("should create a checkpoint with custom label", async () => {
      const { gitService } = createMockGitService({
        "status --porcelain": { ok: true, stdout: " M file.js\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.createCheckpoint({
        label: "before-refactor",
        date: new Date("2026-08-27T16:30:00"),
      });

      assert.equal(result.created, true);
      assert.ok(result.message.includes("before-refactor"));
    });

    it("should run git add -A and git stash push", async () => {
      const { gitService, calls } = createMockGitService({
        "status --porcelain": { ok: true, stdout: " M file.js\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      await service.createCheckpoint({ date: new Date("2026-08-27T16:30:00") });

      const addCall = calls.find((c) => c.args[0] === "add" && c.args[1] === "-A");
      assert.ok(addCall, "should call git add -A");

      const stashCall = calls.find((c) => c.args[0] === "stash" && c.args[1] === "push");
      assert.ok(stashCall, "should call git stash push");
      assert.equal(stashCall.args[2], "-m");
      assert.ok(stashCall.args[3].startsWith(CHECKPOINT_PREFIX));
    });

    it("should skip checkpoint when no uncommitted changes", async () => {
      const { gitService } = createMockGitService({
        "status --porcelain": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.createCheckpoint();

      assert.equal(result.created, false);
      assert.equal(result.message, "No uncommitted changes to checkpoint.");
    });

    it("should skip checkpoint when not a git repo", async () => {
      const gitService = {
        commandRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        isGitRepository: async () => false,
      };

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.createCheckpoint();

      assert.equal(result.created, false);
      assert.equal(result.message, "Not a git repository.");
    });

    it("should use the provided cwd over the default", async () => {
      const { gitService, calls } = createMockGitService({
        "status --porcelain": { ok: true, stdout: " M file.js\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/default" });
      await service.createCheckpoint({ cwd: "/override", date: new Date() });

      assert.ok(calls.some((c) => c.cwd === "/override"));
    });
  });

  describe("listCheckpoints", () => {
    it("should parse fortify checkpoints from stash list", async () => {
      const stashOutput = [
        "stash@{0}: On main: fortify/checkpoint/2026-08-27T16:30:00/pre-edit",
        "stash@{1}: WIP on main: 3abc123 my manual stash",
        "stash@{2}: On main: fortify/checkpoint/2026-08-27T16:25:00/before-refactor",
      ].join("\n");

      const { gitService } = createMockGitService({
        "stash list": { ok: true, stdout: stashOutput, stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const checkpoints = await service.listCheckpoints();

      assert.equal(checkpoints.length, 2);

      assert.equal(checkpoints[0].index, 0);
      assert.equal(checkpoints[0].timestamp, "2026-08-27T16:30:00");
      assert.equal(checkpoints[0].label, "pre-edit");

      assert.equal(checkpoints[1].index, 2);
      assert.equal(checkpoints[1].timestamp, "2026-08-27T16:25:00");
      assert.equal(checkpoints[1].label, "before-refactor");
    });

    it("should return empty array when no stashes exist", async () => {
      const { gitService } = createMockGitService({
        "stash list": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const checkpoints = await service.listCheckpoints();
      assert.deepEqual(checkpoints, []);
    });

    it("should return empty array when no fortify checkpoints exist", async () => {
      const { gitService } = createMockGitService({
        "stash list": {
          ok: true,
          stdout: "stash@{0}: WIP on main: 3abc123 user stash\n",
          stderr: "",
          exitCode: 0,
        },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const checkpoints = await service.listCheckpoints();
      assert.deepEqual(checkpoints, []);
    });

    it("should return empty array when not a git repo", async () => {
      const gitService = {
        commandRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        isGitRepository: async () => false,
      };

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const checkpoints = await service.listCheckpoints();
      assert.deepEqual(checkpoints, []);
    });

    it("should handle stash list command failure", async () => {
      const { gitService } = createMockGitService({
        "stash list": { ok: false, stdout: "", stderr: "error", exitCode: 1 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const checkpoints = await service.listCheckpoints();
      assert.deepEqual(checkpoints, []);
    });

    it("should preserve raw stash line", async () => {
      const rawLine = "stash@{0}: On main: fortify/checkpoint/2026-08-27T16:30:00/pre-edit";
      const { gitService } = createMockGitService({
        "stash list": { ok: true, stdout: rawLine + "\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const checkpoints = await service.listCheckpoints();
      assert.equal(checkpoints[0].raw, rawLine);
    });
  });

  describe("restoreCheckpoint", () => {
    it("should restore a specific checkpoint by index", async () => {
      const { gitService, calls } = createMockGitService({
        "stash pop stash@{2}": { ok: true, stdout: "Restored", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.restoreCheckpoint({ index: 2 });

      assert.equal(result.restored, true);
      assert.ok(result.message.includes("stash@{2}"));
    });

    it("should restore the latest fortify checkpoint when no index given", async () => {
      const stashOutput = "stash@{0}: On main: fortify/checkpoint/2026-08-27T16:30:00/pre-edit\n";
      const { gitService, calls } = createMockGitService({
        "stash list": { ok: true, stdout: stashOutput, stderr: "", exitCode: 0 },
        "stash pop stash@{0}": { ok: true, stdout: "Restored", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.restoreCheckpoint();

      assert.equal(result.restored, true);
    });

    it("should reset current changes before restoring", async () => {
      const stashOutput = "stash@{0}: On main: fortify/checkpoint/2026-08-27T16:30:00/pre-edit\n";
      const { gitService, calls } = createMockGitService({
        "stash list": { ok: true, stdout: stashOutput, stderr: "", exitCode: 0 },
        "stash pop stash@{0}": { ok: true, stdout: "Restored", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      await service.restoreCheckpoint();

      const checkoutCall = calls.find((c) => c.args[0] === "checkout" && c.args[1] === "--");
      assert.ok(checkoutCall, "should run git checkout -- .");

      const cleanCall = calls.find((c) => c.args[0] === "clean" && c.args[1] === "-fd");
      assert.ok(cleanCall, "should run git clean -fd");
    });

    it("should return error when no checkpoints exist", async () => {
      const { gitService } = createMockGitService({
        "stash list": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.restoreCheckpoint();

      assert.equal(result.restored, false);
      assert.equal(result.error, "No Fortify checkpoints found.");
    });

    it("should return error when stash pop fails", async () => {
      const { gitService } = createMockGitService({
        "stash pop stash@{0}": {
          ok: false,
          stdout: "",
          stderr: "merge conflict",
          exitCode: 1,
        },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.restoreCheckpoint({ index: 0 });

      assert.equal(result.restored, false);
      assert.ok(result.error.includes("merge conflict"));
    });

    it("should return error when not a git repo", async () => {
      const gitService = {
        commandRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        isGitRepository: async () => false,
      };

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.restoreCheckpoint();

      assert.equal(result.restored, false);
      assert.equal(result.error, "Not a git repository.");
    });
  });

  describe("dropCheckpoint", () => {
    it("should drop a specific checkpoint by index", async () => {
      const { gitService, calls } = createMockGitService({
        "stash drop stash@{1}": { ok: true, stdout: "Dropped", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.dropCheckpoint({ index: 1 });

      assert.equal(result.dropped, true);
    });

    it("should drop the latest fortify checkpoint when no index given", async () => {
      const stashOutput = "stash@{0}: On main: fortify/checkpoint/2026-08-27T16:30:00/pre-edit\n";
      const { gitService } = createMockGitService({
        "stash list": { ok: true, stdout: stashOutput, stderr: "", exitCode: 0 },
        "stash drop stash@{0}": { ok: true, stdout: "Dropped", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.dropCheckpoint();

      assert.equal(result.dropped, true);
    });

    it("should return error when no checkpoints exist", async () => {
      const { gitService } = createMockGitService({
        "stash list": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.dropCheckpoint();

      assert.equal(result.dropped, false);
      assert.equal(result.error, "No Fortify checkpoints found.");
    });

    it("should return error when stash drop fails", async () => {
      const { gitService } = createMockGitService({
        "stash drop stash@{5}": { ok: false, stdout: "", stderr: "invalid ref", exitCode: 1 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.dropCheckpoint({ index: 5 });

      assert.equal(result.dropped, false);
      assert.ok(result.error.includes("invalid ref"));
    });

    it("should return error when not a git repo", async () => {
      const gitService = {
        commandRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        isGitRepository: async () => false,
      };

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const result = await service.dropCheckpoint({ index: 0 });

      assert.equal(result.dropped, false);
    });
  });

  describe("hasUncommittedChanges", () => {
    it("should return true when there are modified files", async () => {
      const { gitService } = createMockGitService({
        "status --porcelain": { ok: true, stdout: " M src/index.js\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      assert.equal(await service.hasUncommittedChanges(), true);
    });

    it("should return true when there are untracked files", async () => {
      const { gitService } = createMockGitService({
        "status --porcelain": { ok: true, stdout: "?? new-file.js\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      assert.equal(await service.hasUncommittedChanges(), true);
    });

    it("should return false when working tree is clean", async () => {
      const { gitService } = createMockGitService({
        "status --porcelain": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      assert.equal(await service.hasUncommittedChanges(), false);
    });

    it("should return false when not a git repo", async () => {
      const gitService = {
        commandRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        isGitRepository: async () => false,
      };

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      assert.equal(await service.hasUncommittedChanges(), false);
    });

    it("should return false when status command fails", async () => {
      const { gitService } = createMockGitService({
        "status --porcelain": { ok: false, stdout: "", stderr: "error", exitCode: 1 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      assert.equal(await service.hasUncommittedChanges(), false);
    });
  });

  describe("getCurrentDiff", () => {
    it("should combine unstaged and staged diffs", async () => {
      const { gitService } = createMockGitService({
        "diff": { ok: true, stdout: "unstaged diff content\n", stderr: "", exitCode: 0 },
        "diff --cached": { ok: true, stdout: "staged diff content\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const diff = await service.getCurrentDiff();

      assert.ok(diff.includes("unstaged diff content"));
      assert.ok(diff.includes("staged diff content"));
    });

    it("should return only unstaged diff when nothing is staged", async () => {
      const { gitService } = createMockGitService({
        "diff": { ok: true, stdout: "unstaged changes\n", stderr: "", exitCode: 0 },
        "diff --cached": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const diff = await service.getCurrentDiff();

      assert.ok(diff.includes("unstaged changes"));
      assert.ok(!diff.includes("staged diff content"));
    });

    it("should return empty string when no changes", async () => {
      const { gitService } = createMockGitService({
        "diff": { ok: true, stdout: "", stderr: "", exitCode: 0 },
        "diff --cached": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const diff = await service.getCurrentDiff();

      assert.equal(diff, "");
    });

    it("should return empty string when not a git repo", async () => {
      const gitService = {
        commandRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        isGitRepository: async () => false,
      };

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      assert.equal(await service.getCurrentDiff(), "");
    });
  });

  describe("getDiffSummary", () => {
    it("should return diff stat output", async () => {
      const statOutput = " src/index.js | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)";
      const { gitService } = createMockGitService({
        "diff --stat": { ok: true, stdout: statOutput + "\n", stderr: "", exitCode: 0 },
        "diff --cached --stat": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const summary = await service.getDiffSummary();

      assert.ok(summary.includes("src/index.js"));
    });

    it("should show staged separator when both staged and unstaged exist", async () => {
      const { gitService } = createMockGitService({
        "diff --stat": { ok: true, stdout: "unstaged\n", stderr: "", exitCode: 0 },
        "diff --cached --stat": { ok: true, stdout: "staged\n", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const summary = await service.getDiffSummary();

      assert.ok(summary.includes("--- Staged ---"));
    });

    it("should return empty string when not a git repo", async () => {
      const gitService = {
        commandRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        isGitRepository: async () => false,
      };

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      assert.equal(await service.getDiffSummary(), "");
    });
  });

  describe("getPerFileDiffs", () => {
    it("should parse per-file diffs from unified diff output", async () => {
      const diffOutput = [
        "diff --git a/src/index.js b/src/index.js",
        "--- a/src/index.js",
        "+++ b/src/index.js",
        "@@ -1,3 +1,4 @@",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 3;",
        "+const c = 4;",
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1 +1 @@",
        "-# Old Title",
        "+# New Title",
      ].join("\n");

      const { gitService } = createMockGitService({
        "diff HEAD": { ok: true, stdout: diffOutput, stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const files = await service.getPerFileDiffs();

      assert.equal(files.length, 2);
      assert.equal(files[0].file, "src/index.js");
      assert.equal(files[0].additions, 2);
      assert.equal(files[0].deletions, 1);
      assert.equal(files[1].file, "README.md");
      assert.equal(files[1].additions, 1);
      assert.equal(files[1].deletions, 1);
    });

    it("should return empty array when no changes", async () => {
      const { gitService } = createMockGitService({
        "diff HEAD": { ok: true, stdout: "", stderr: "", exitCode: 0 },
        "diff": { ok: true, stdout: "", stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const files = await service.getPerFileDiffs();

      assert.deepEqual(files, []);
    });

    it("should filter by specific file path", async () => {
      const { gitService, calls } = createMockGitService({
        "diff HEAD -- src/index.js": {
          ok: true,
          stdout: "diff --git a/src/index.js b/src/index.js\n--- a/src/index.js\n+++ b/src/index.js\n@@ -1 +1 @@\n-old\n+new\n",
          stderr: "",
          exitCode: 0,
        },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const files = await service.getPerFileDiffs({ filePath: "src/index.js" });

      assert.equal(files.length, 1);
      assert.equal(files[0].file, "src/index.js");
    });

    it("should fallback to diff without HEAD for fresh repos", async () => {
      const diffOutput = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n";
      const { gitService } = createMockGitService({
        "diff HEAD": { ok: false, stdout: "", stderr: "ambiguous argument 'HEAD'", exitCode: 128 },
        "diff": { ok: true, stdout: diffOutput, stderr: "", exitCode: 0 },
      });

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      const files = await service.getPerFileDiffs();

      assert.equal(files.length, 1);
    });

    it("should return empty array when not a git repo", async () => {
      const gitService = {
        commandRunner: async () => ({ ok: true, stdout: "", stderr: "", exitCode: 0 }),
        isGitRepository: async () => false,
      };

      const service = new GitCheckpointService({ gitService, cwd: "/test" });
      assert.deepEqual(await service.getPerFileDiffs(), []);
    });
  });

  describe("exports", () => {
    it("should export CHECKPOINT_PREFIX constant", () => {
      assert.equal(CHECKPOINT_PREFIX, "fortify/checkpoint/");
    });

    it("should export DEFAULT_LABEL constant", () => {
      assert.equal(DEFAULT_LABEL, "pre-edit");
    });
  });
});
