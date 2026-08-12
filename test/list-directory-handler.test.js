import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listDirectoryHandler, formatSize } from "../src/tools/list-directory-handler.js";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

let tmpDir;

async function setup() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "fortify-listdir-test-"));
}

async function teardown() {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function createFile(relativePath, content = "") {
  const fullPath = path.join(tmpDir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}

function createMockIgnore(dirNames = []) {
  return {
    shouldIgnore: () => false,
    shouldIgnoreDirectory: (name) => dirNames.includes(name),
  };
}

// ─────────────────────────────────────────────────────────────────
// formatSize
// ─────────────────────────────────────────────────────────────────

describe("formatSize", () => {
  it("formats bytes", () => {
    assert.equal(formatSize(500), "500B");
  });

  it("formats kilobytes", () => {
    assert.equal(formatSize(2048), "2.0KB");
  });

  it("formats megabytes", () => {
    assert.equal(formatSize(1_500_000), "1.4MB");
  });
});

// ─────────────────────────────────────────────────────────────────
// listDirectoryHandler
// ─────────────────────────────────────────────────────────────────

describe("listDirectoryHandler", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("lists files and directories in tree format", async () => {
    await createFile("src/index.js", "const x = 1;\n");
    await createFile("src/utils/helper.js", "export {};\n");
    await createFile("README.md", "# Hello\n");

    const result = await listDirectoryHandler(
      { path: "." },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("src/"));
    assert.ok(result.output.includes("README.md"));
    assert.ok(result.output.includes("├──") || result.output.includes("└──"));
  });

  it("shows file sizes", async () => {
    await createFile("small.txt", "hello");

    const result = await listDirectoryHandler(
      { path: "." },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("5B"));
  });

  it("shows directory entry counts", async () => {
    await createFile("src/a.js", "");
    await createFile("src/b.js", "");
    await createFile("src/c.js", "");

    const result = await listDirectoryHandler(
      { path: "." },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("3 entries"));
  });

  it("sorts directories before files", async () => {
    await createFile("zebra.txt", "");
    await createFile("alpha/file.js", "");

    const result = await listDirectoryHandler(
      { path: "." },
      { cwd: tmpDir },
    );

    const lines = result.output.split("\n");
    const alphaLine = lines.findIndex((l) => l.includes("alpha/"));
    const zebraLine = lines.findIndex((l) => l.includes("zebra.txt"));
    assert.ok(alphaLine < zebraLine, "Directories should come before files");
  });

  it("respects max depth", async () => {
    await createFile("a/b/c/d/deep.txt", "deep");

    const result = await listDirectoryHandler(
      { path: ".", depth: 2 },
      { cwd: tmpDir },
    );

    // Should show a/ and a/b/ but not deeper
    assert.ok(result.output.includes("a/"));
    assert.ok(result.output.includes("b/"));
    // The deep file should NOT appear at depth 2
    assert.ok(!result.output.includes("deep.txt"));
  });

  it("respects ignore patterns", async () => {
    await createFile("src/app.js", "");
    await createFile("node_modules/pkg/index.js", "");

    const mockIgnore = createMockIgnore(["node_modules"]);
    const result = await listDirectoryHandler(
      { path: "." },
      { cwd: tmpDir, fortifyIgnore: mockIgnore },
    );

    assert.ok(result.output.includes("src/"));
    assert.ok(!result.output.includes("node_modules"));
  });

  it("lists a subdirectory", async () => {
    await createFile("src/a.js", "");
    await createFile("src/b.js", "");
    await createFile("test/t.js", "");

    const result = await listDirectoryHandler(
      { path: "src" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("a.js"));
    assert.ok(result.output.includes("b.js"));
    assert.ok(!result.output.includes("t.js"));
  });

  it("returns error for non-existent directory", async () => {
    const result = await listDirectoryHandler(
      { path: "nonexistent" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("not found"));
  });

  it("returns error if path is a file", async () => {
    await createFile("file.txt", "content");

    const result = await listDirectoryHandler(
      { path: "file.txt" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("not a directory"));
  });

  it("shows summary with file and directory counts", async () => {
    await createFile("src/a.js", "");
    await createFile("src/b.js", "");
    await createFile("lib/c.js", "");

    const result = await listDirectoryHandler(
      { path: "." },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("director"));
    assert.ok(result.output.includes("file"));
  });

  it("defaults to current directory when path is omitted", async () => {
    await createFile("root-file.txt", "hello");

    const result = await listDirectoryHandler(
      {},
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("root-file.txt"));
  });

  it("handles empty directories", async () => {
    await mkdir(path.join(tmpDir, "empty-dir"), { recursive: true });

    const result = await listDirectoryHandler(
      { path: "." },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("empty-dir/"));
    assert.ok(result.output.includes("empty"));
  });
});
