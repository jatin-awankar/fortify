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
