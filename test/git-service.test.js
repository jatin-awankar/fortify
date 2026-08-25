import assert from "node:assert/strict";
import test from "node:test";
import { GitService, GitServiceError } from "../src/services/git-service.js";

function createGitService(results) {
  const calls = [];
  const service = new GitService({
    cwd: "repo",
    commandRunner: async (args, options) => {
      calls.push({ args, options });
      const result = results.shift();
      if (result instanceof Error) {
        throw result;
      }

      return result;
    },
  });

  return { service, calls };
}

test("isGitRepository returns false for git exit code 128", async () => {
  const { service } = createGitService([{ ok: false, exitCode: 128, stdout: "", stderr: "fatal", args: [] }]);
  assert.equal(await service.isGitRepository(), false);
});

test("getStagedDiff returns mocked staged diff", async () => {
  const { service, calls } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "diff --git a/a b/a\n", stderr: "", args: [] },
  ]);

  assert.match(await service.getStagedDiff(), /diff --git/);
  assert.deepEqual(calls[1].args, ["diff", "--cached"]);
});

test("getStagedDiffSummary runs git diff --cached --stat", async () => {
  const { service, calls } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: " file.js | 1 +\n", stderr: "", args: [] },
  ]);

  assert.match(await service.getStagedDiffSummary(), /file\.js/);
  assert.deepEqual(calls[1].args, ["diff", "--cached", "--stat"]);
});

test("commitWithMessage splits subject and body into separate -m flags", async () => {
  const { service, calls } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "committed", stderr: "", args: [] },
  ]);

  const result = await service.commitWithMessage({ message: "feat: add config\n\nBody text" });
  assert.equal(result.output, "committed");
  assert.deepEqual(calls[1].args, ["commit", "-m", "feat: add config\n\nBody text"]);
});

test("commitWithMessage rejects empty messages", async () => {
  const { service } = createGitService([]);
  await assert.rejects(
    () => service.commitWithMessage({ message: " " }),
    (error) => error instanceof GitServiceError && error.code === "GIT_INVALID_COMMIT_MESSAGE",
  );
});

// ── getTrackedFiles ──

test("getTrackedFiles returns file list from git ls-files", async () => {
  const { service, calls } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "src/index.js\nsrc/utils.js\nREADME.md\n", stderr: "", args: [] },
  ]);

  const files = await service.getTrackedFiles();
  assert.deepEqual(files, ["src/index.js", "src/utils.js", "README.md"]);
  assert.deepEqual(calls[1].args, ["ls-files"]);
});

test("getTrackedFiles returns empty array for non-git directory", async () => {
  const { service } = createGitService([
    { ok: false, exitCode: 128, stdout: "", stderr: "fatal: not a git repository", args: [] },
  ]);

  const files = await service.getTrackedFiles();
  assert.deepEqual(files, []);
});

test("getTrackedFiles returns empty array when ls-files fails", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: false, exitCode: 1, stdout: "", stderr: "error", args: [] },
  ]);

  const files = await service.getTrackedFiles();
  assert.deepEqual(files, []);
});

test("getTrackedFiles handles empty repository (no files tracked)", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "\n", stderr: "", args: [] },
  ]);

  const files = await service.getTrackedFiles();
  assert.deepEqual(files, []);
});

test("getTrackedFiles trims whitespace from paths", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "  file.js  \n  dir/other.js \n", stderr: "", args: [] },
  ]);

  const files = await service.getTrackedFiles();
  assert.deepEqual(files, ["file.js", "dir/other.js"]);
});

// ── getFileStatus ──

test("getFileStatus parses modified files", async () => {
  const { service, calls } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: " M src/index.js\n", stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.get("src/index.js"), "M");
  assert.deepEqual(calls[1].args, ["status", "--porcelain"]);
});

test("getFileStatus parses staged modified files", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "M  src/index.js\n", stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.get("src/index.js"), "M");
});

test("getFileStatus parses added files", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "A  new-file.js\n", stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.get("new-file.js"), "A");
});

test("getFileStatus parses deleted files", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: " D removed.js\n", stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.get("removed.js"), "D");
});

test("getFileStatus parses untracked files", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "?? untracked.js\n", stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.get("untracked.js"), "?");
});

test("getFileStatus parses renamed files and keeps new path", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "R  old-name.js -> new-name.js\n", stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.get("new-name.js"), "R");
  assert.equal(statusMap.has("old-name.js"), false);
});

test("getFileStatus handles quoted paths with spaces", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: ' M "path with spaces/file.js"\n', stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.get("path with spaces/file.js"), "M");
});

test("getFileStatus handles multiple statuses", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    {
      ok: true, exitCode: 0,
      stdout: " M src/modified.js\nA  src/added.js\n?? untracked.txt\n D deleted.js\n",
      stderr: "", args: [],
    },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.size, 4);
  assert.equal(statusMap.get("src/modified.js"), "M");
  assert.equal(statusMap.get("src/added.js"), "A");
  assert.equal(statusMap.get("untracked.txt"), "?");
  assert.equal(statusMap.get("deleted.js"), "D");
});

test("getFileStatus returns empty map for non-git directory", async () => {
  const { service } = createGitService([
    { ok: false, exitCode: 128, stdout: "", stderr: "fatal", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.size, 0);
});

test("getFileStatus returns empty map when command fails", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: false, exitCode: 1, stdout: "", stderr: "error", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.size, 0);
});

test("getFileStatus returns empty map for clean working tree", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "", stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.size, 0);
});

test("getFileStatus skips corrupted short lines", async () => {
  const { service } = createGitService([
    { ok: true, exitCode: 0, stdout: "true\n", stderr: "", args: [] },
    { ok: true, exitCode: 0, stdout: "XY\n M valid.js\n", stderr: "", args: [] },
  ]);

  const statusMap = await service.getFileStatus();
  assert.equal(statusMap.size, 1);
  assert.equal(statusMap.get("valid.js"), "M");
});
