import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { searchFilesHandler, MAX_RESULTS } from "../src/tools/search-files-handler.js";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

let tmpDir;

async function setup() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "fortify-search-test-"));
}

async function teardown() {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function createFile(relativePath, content) {
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
// searchFilesHandler
// ─────────────────────────────────────────────────────────────────

describe("searchFilesHandler", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("finds text matches across files", async () => {
    await createFile("src/a.js", "const TIMEOUT_MS = 1000;\nconst RETRY = true;\n");
    await createFile("src/b.js", "const TIMEOUT_MS = 5000;\nconst MAX = 10;\n");
    await createFile("README.md", "# Project\nThis is a readme.\n");

    const result = await searchFilesHandler(
      { query: "TIMEOUT_MS" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("src/a.js:1:"));
    assert.ok(result.output.includes("src/b.js:1:"));
    assert.ok(result.output.includes("2 matches"));
    assert.ok(result.output.includes("2 files"));
  });

  it("is case-insensitive by default", async () => {
    await createFile("test.js", "const Foo = 1;\nconst FOO = 2;\nconst foo = 3;\n");

    const result = await searchFilesHandler(
      { query: "foo" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("3 matches"));
  });

  it("supports regex mode", async () => {
    await createFile("code.js", "const x = 123;\nconst y = 'hello';\nconst z = 456;\n");

    const result = await searchFilesHandler(
      { query: "\\d{3}", regex: true },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("code.js:1:"));
    assert.ok(result.output.includes("code.js:3:"));
    assert.ok(result.output.includes("2 matches"));
  });

  it("scopes search to a subdirectory", async () => {
    await createFile("src/app.js", "const FOUND = true;\n");
    await createFile("test/app.test.js", "const FOUND = true;\n");

    const result = await searchFilesHandler(
      { query: "FOUND", path: "src" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("1 match"));
    assert.ok(result.output.includes("src"));
    assert.ok(!result.output.includes("test/"));
  });

  it("returns no-match message when nothing found", async () => {
    await createFile("empty.js", "nothing here\n");

    const result = await searchFilesHandler(
      { query: "NONEXISTENT" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("No matches found"));
  });

  it("respects ignore patterns", async () => {
    await createFile("src/app.js", "MATCH\n");
    await createFile("vendor/lib.js", "MATCH\n");

    const mockIgnore = createMockIgnore(["vendor"]);
    const result = await searchFilesHandler(
      { query: "MATCH" },
      { cwd: tmpDir, fortifyIgnore: mockIgnore },
    );

    assert.ok(result.output.includes("1 match"));
    assert.ok(result.output.includes("src/app.js"));
    assert.ok(!result.output.includes("vendor/"));
  });

  it("skips binary files", async () => {
    await createFile("text.js", "searchable content\n");
    const binaryPath = path.join(tmpDir, "binary.dat");
    await writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]));

    const result = await searchFilesHandler(
      { query: "searchable" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("1 match"));
  });

  it("returns error for empty query", async () => {
    const result = await searchFilesHandler(
      { query: "" },
      { cwd: tmpDir },
    );
    assert.ok(result.output.includes("[Error]"));
  });

  it("returns error for invalid regex", async () => {
    const result = await searchFilesHandler(
      { query: "[invalid(", regex: true },
      { cwd: tmpDir },
    );
    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("Invalid regex"));
  });

  it("truncates long matching lines", async () => {
    const longLine = "x".repeat(300) + "FINDME" + "y".repeat(300);
    await createFile("long.js", longLine + "\n");

    const result = await searchFilesHandler(
      { query: "FINDME" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("1 match"));
    // The line content in results should be truncated to 200 chars
    const matchLine = result.output.split("\n")[0];
    assert.ok(matchLine.length < 250);
  });

  it("reports file count accurately", async () => {
    await createFile("a.js", "target\n");
    await createFile("b.js", "target\ntarget\n");
    await createFile("c.js", "no match\n");

    const result = await searchFilesHandler(
      { query: "target" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("3 matches"));
    assert.ok(result.output.includes("2 files"));
  });
});
