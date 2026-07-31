import assert from "node:assert/strict";
import test from "node:test";
import { ProjectContextService } from "../src/services/project-context-service.js";

class MockGitService {
  constructor({ isGit = true, branch = "main", commits = ["commit 1", "commit 2"], remote = "git@github.com:user/repo.git" } = {}) {
    this.isGit = isGit;
    this.branch = branch;
    this.commits = commits;
    this.remote = remote;
  }
  async isGitRepository() {
    return this.isGit;
  }
  async getCurrentBranchName() {
    return this.branch;
  }
  async getRecentCommits() {
    return this.commits;
  }
  async getRemoteUrl() {
    return this.remote;
  }
}

function createProjectContextService({ files = {}, gitOptions = {}, projectConfig = null } = {}) {
  const mockFs = {
    access: async (filePath) => {
      const baseName = filePath.split(/[/\\]/).pop();
      if (files[baseName]) {
        return;
      }
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    },
    mkdir: async () => {},
    readFile: async (filePath) => {
      if (projectConfig && filePath.endsWith("project.json")) {
        return JSON.stringify(projectConfig);
      }
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    },
    writeFile: async () => {}
  };

  const gitService = new MockGitService(gitOptions);
  return new ProjectContextService({
    cwd: "workspace",
    gitService,
    fsPromises: mockFs
  });
}

test("ProjectContextService detects Node.js when package.json is present", async () => {
  const service = createProjectContextService({
    files: { "package.json": true }
  });
  const stack = await service.detectStack();
  assert.deepEqual(stack, ["Node.js"]);
});

test("ProjectContextService detects Python when requirements.txt is present", async () => {
  const service = createProjectContextService({
    files: { "requirements.txt": true }
  });
  const stack = await service.detectStack();
  assert.deepEqual(stack, ["Python"]);
});

test("ProjectContextService returns Unknown when no signatures are present", async () => {
  const service = createProjectContextService({
    files: {}
  });
  const stack = await service.detectStack();
  assert.deepEqual(stack, ["Unknown"]);
});

test("ProjectContextService loads context summary for non-git project", async () => {
  const service = createProjectContextService({
    files: { "package.json": true },
    gitOptions: { isGit: false }
  });
  const summary = await service.getProjectContextSummary();
  assert.equal(summary.name, "unnamed-project");
  assert.deepEqual(summary.stack, ["Node.js"]);
  assert.equal(summary.git, null);
});

test("ProjectContextService loads context summary with git details", async () => {
  const service = createProjectContextService({
    files: { "Cargo.toml": true },
    gitOptions: { isGit: true, branch: "feature-branch", commits: ["a1b2c3d commit msg"], remote: "https://github.com/foo/bar" }
  });
  const summary = await service.getProjectContextSummary();
  assert.equal(summary.name, "workspace");
  assert.deepEqual(summary.stack, ["Rust"]);
  assert.notEqual(summary.git, null);
  assert.equal(summary.git.branch, "feature-branch");
  assert.deepEqual(summary.git.recentCommits, ["a1b2c3d commit msg"]);
  assert.equal(summary.git.remoteUrl, "https://github.com/foo/bar");
});

test("ProjectContextService formats system prompt context correctly", () => {
  const service = createProjectContextService();
  const summary = {
    name: "test-app",
    stack: ["Node.js", "Python"],
    instructions: "Use standard JS formatting.",
    git: {
      branch: "main",
      remoteUrl: "git@github.com:foo/bar.git",
      recentCommits: ["c1 commit one", "c2 commit two"]
    }
  };

  const formatted = service.formatSystemPromptContext(summary);
  assert.match(formatted, /Name: test-app/);
  assert.match(formatted, /Stack: Node\.js, Python/);
  assert.match(formatted, /Custom Guidelines\/Memory: Use standard JS formatting\./);
  assert.match(formatted, /Git Branch: main/);
  assert.match(formatted, /Git Remote: git@github\.com:foo\/bar\.git/);
  assert.match(formatted, /Recent Commits:/);
  assert.match(formatted, /- c1 commit one/);
});
