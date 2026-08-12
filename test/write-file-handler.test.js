import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  writeFileHandler,
  resolveAndValidateWritePath,
  checkExistingFile,
  MAX_WRITE_BYTES,
} from "../src/tools/write-file-handler.js";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

let tmpDir;

async function setup() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "fortify-write-test-"));
}

async function teardown() {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function readCreatedFile(relativePath) {
  return readFile(path.join(tmpDir, relativePath), "utf8");
}

async function fileExists(relativePath) {
  try {
    await stat(path.join(tmpDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// resolveAndValidateWritePath
// ─────────────────────────────────────────────────────────────────

describe("resolveAndValidateWritePath", () => {
  it("resolves a valid relative path", () => {
    const { absolutePath, normalizedRelative } = resolveAndValidateWritePath(
      "src/new-file.js",
      "/project",
    );
    assert.ok(absolutePath.includes("new-file.js"));
    assert.equal(normalizedRelative, "src/new-file.js");
  });

  it("throws on empty path", () => {
    assert.throws(() => resolveAndValidateWritePath("", "/project"), /required/i);
  });

  it("throws on null path", () => {
    assert.throws(() => resolveAndValidateWritePath(null, "/project"), /required/i);
  });

  it("rejects path traversal", () => {
    assert.throws(
      () => resolveAndValidateWritePath("../../etc/evil.js", "/project/src"),
      /outside the project root/i,
    );
  });

  it("rejects null bytes in path", () => {
    assert.throws(
      () => resolveAndValidateWritePath("file\0.js", "/project"),
      /null bytes/i,
    );
  });

  it("normalizes backslashes", () => {
    const { normalizedRelative } = resolveAndValidateWritePath(
      "src\\utils\\file.js",
      "/project",
    );
    assert.equal(normalizedRelative, "src/utils/file.js");
  });
});

// ─────────────────────────────────────────────────────────────────
// checkExistingFile
// ─────────────────────────────────────────────────────────────────

describe("checkExistingFile", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("returns exists: false for non-existent file", async () => {
    const result = await checkExistingFile(
      path.join(tmpDir, "nope.js"),
      { stat },
    );
    assert.equal(result.exists, false);
  });

  it("returns exists: true for existing file", async () => {
    await writeFile(path.join(tmpDir, "existing.js"), "hello", "utf8");
    const result = await checkExistingFile(
      path.join(tmpDir, "existing.js"),
      { stat },
    );
    assert.equal(result.exists, true);
    assert.equal(result.isFile, true);
  });

  it("detects directories", async () => {
    await mkdir(path.join(tmpDir, "mydir"), { recursive: true });
    const result = await checkExistingFile(
      path.join(tmpDir, "mydir"),
      { stat },
    );
    assert.equal(result.exists, true);
    assert.equal(result.isDirectory, true);
    assert.equal(result.isFile, false);
  });
});

// ─────────────────────────────────────────────────────────────────
// writeFileHandler — integration tests
// ─────────────────────────────────────────────────────────────────

describe("writeFileHandler", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("creates a new file", async () => {
    const result = await writeFileHandler(
      { path: "hello.js", content: 'console.log("hello");\n' },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("Created"));
    assert.ok(result.output.includes("hello.js"));

    const written = await readCreatedFile("hello.js");
    assert.equal(written, 'console.log("hello");\n');
  });

  it("creates parent directories automatically", async () => {
    const result = await writeFileHandler(
      { path: "src/deep/nested/file.js", content: "export const x = 1;\n" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("Created"));
    assert.ok(result.output.includes("src/deep/nested/file.js"));

    const written = await readCreatedFile("src/deep/nested/file.js");
    assert.equal(written, "export const x = 1;\n");
  });

  it("overwrites existing files and reports 'Updated'", async () => {
    // Create the initial file
    await mkdir(path.join(tmpDir, "src"), { recursive: true });
    await writeFile(path.join(tmpDir, "src/config.js"), "old content", "utf8");

    const result = await writeFileHandler(
      { path: "src/config.js", content: "new content" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("Updated"));
    assert.ok(result.output.includes("previously"));

    const written = await readCreatedFile("src/config.js");
    assert.equal(written, "new content");
  });

  it("reports line count and size", async () => {
    const content = "line1\nline2\nline3\n";
    const result = await writeFileHandler(
      { path: "multi.txt", content },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("4 lines"));
  });

  it("returns error for null content", async () => {
    const result = await writeFileHandler(
      { path: "empty.js", content: null },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("content is required"));
  });

  it("returns error for undefined content", async () => {
    const result = await writeFileHandler(
      { path: "empty.js", content: undefined },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
  });

  it("rejects writing to a directory path", async () => {
    await mkdir(path.join(tmpDir, "mydir"), { recursive: true });

    const result = await writeFileHandler(
      { path: "mydir", content: "some content" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("directory"));
  });

  it("rejects content exceeding max size", async () => {
    const hugeContent = "x".repeat(MAX_WRITE_BYTES + 1);
    const result = await writeFileHandler(
      { path: "huge.txt", content: hugeContent },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("too large"));
    // File should NOT have been created
    assert.ok(!(await fileExists("huge.txt")));
  });

  it("rejects path traversal attempts", async () => {
    await assert.rejects(
      async () =>
        writeFileHandler(
          { path: "../../etc/evil.txt", content: "evil" },
          { cwd: tmpDir },
        ),
      /outside the project root/i,
    );
  });

  it("handles empty string content (creates empty file)", async () => {
    const result = await writeFileHandler(
      { path: "blank.txt", content: "" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("Created"));
    const written = await readCreatedFile("blank.txt");
    assert.equal(written, "");
  });

  it("correctly sizes multi-byte content", async () => {
    const unicodeContent = "こんにちは世界\n"; // Japanese characters
    const result = await writeFileHandler(
      { path: "unicode.txt", content: unicodeContent },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("Created"));
    const written = await readCreatedFile("unicode.txt");
    assert.equal(written, unicodeContent);
  });
});
