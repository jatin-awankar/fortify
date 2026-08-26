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

// ── Phase 2 additions ────────────────────────────────────────────────

test("getMemoryPath returns correct path under .fortify", () => {
  const service = createProjectContextService();
  const memoryPath = service.getMemoryPath();
  assert.ok(memoryPath.includes(".fortify"), "Path should include .fortify dir");
  assert.ok(memoryPath.endsWith("memory.md"), "Path should end with memory.md");
});

test("getProjectContextSummary sets hasMemory=true when memory.md exists", async () => {
  const service = createProjectContextService({
    files: { "package.json": true, "memory.md": true }
  });
  const summary = await service.getProjectContextSummary();
  assert.equal(summary.hasMemory, true);
});

test("getProjectContextSummary sets hasMemory=false when memory.md absent", async () => {
  const service = createProjectContextService({
    files: { "package.json": true }
  });
  const summary = await service.getProjectContextSummary();
  assert.equal(summary.hasMemory, false);
});

test("formatSystemPromptContext does NOT include identity text", () => {
  const service = createProjectContextService();
  const summary = { name: "app", stack: ["Node.js"], instructions: "", git: null };
  const formatted = service.formatSystemPromptContext(summary);
  assert.ok(!formatted.includes("You are Fortify"), "Should not contain identity text");
  assert.ok(formatted.includes("[Project Context]"), "Should have context header");
});

test("formatFullSystemPrompt includes identity + project context", () => {
  const service = createProjectContextService();
  const summary = { name: "app", stack: ["Go"], instructions: "", git: null };
  const full = service.formatFullSystemPrompt(summary);
  assert.ok(full.includes("You are Fortify"), "Should include identity text");
  assert.ok(full.includes("[Project Context]"), "Should include context block");
  assert.ok(full.includes("Name: app"), "Should include project name");
  assert.ok(full.includes("Stack: Go"), "Should include stack");
});
