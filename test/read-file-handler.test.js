import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  readFileHandler,
  resolveAndValidatePath,
  addLineNumbers,
  detectLanguage,
  containsNullByte,
} from "../src/tools/read-file-handler.js";
import { FortifyIgnore } from "../src/config/fortifyignore.js";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

let tmpDir;

async function setup() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "fortify-read-test-"));
}

async function teardown() {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function createFile(relativePath, content) {
  const fullPath = path.join(tmpDir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  if (typeof content === "string") {
    await writeFile(fullPath, content, "utf8");
  } else {
    // Buffer (binary)
    await writeFile(fullPath, content);
  }
  return fullPath;
}

function createMockIgnore(patterns = []) {
  return {
    shouldIgnore: (p) => {
      for (const pat of patterns) {
        if (p.includes(pat.replace("/", ""))) return true;
      }
      return false;
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// resolveAndValidatePath
// ─────────────────────────────────────────────────────────────────

describe("resolveAndValidatePath", () => {
  it("resolves a relative path within the project", () => {
    const { absolutePath, normalizedRelative } = resolveAndValidatePath(
      "src/index.js",
      "/project",
    );
    assert.ok(absolutePath.includes("src"));
    assert.equal(normalizedRelative, "src/index.js");
  });

  it("throws on empty path", () => {
    assert.throws(() => resolveAndValidatePath("", "/project"), /required/i);
    assert.throws(() => resolveAndValidatePath("  ", "/project"), /empty/i);
  });

  it("throws on null/undefined path", () => {
    assert.throws(() => resolveAndValidatePath(null, "/project"), /required/i);
    assert.throws(
      () => resolveAndValidatePath(undefined, "/project"),
      /required/i,
    );
  });

  it("rejects path traversal outside project root", () => {
    assert.throws(
      () => resolveAndValidatePath("../../etc/passwd", "/project/src"),
      /outside the project root/i,
    );
  });

  it("normalizes backslashes in relative path", () => {
    const { normalizedRelative } = resolveAndValidatePath(
      "src\\services\\chat.js",
      "/project",
    );
    assert.equal(normalizedRelative, "src/services/chat.js");
  });
});

// ─────────────────────────────────────────────────────────────────
// addLineNumbers
// ─────────────────────────────────────────────────────────────────

describe("addLineNumbers", () => {
  it("prepends line numbers to each line", () => {
    const result = addLineNumbers("line1\nline2\nline3");
    assert.ok(result.includes("1: line1"));
    assert.ok(result.includes("2: line2"));
    assert.ok(result.includes("3: line3"));
  });

  it("pads line numbers for files with many lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const result = addLineNumbers(lines.join("\n"));
    assert.ok(result.includes("  1: line1")); // padded to width 3
    assert.ok(result.includes("100: line100"));
  });

  it("handles empty content", () => {
    const result = addLineNumbers("");
    assert.equal(result, "1: ");
  });

  it("handles single line", () => {
    const result = addLineNumbers("hello world");
    assert.equal(result, "1: hello world");
  });
});

// ─────────────────────────────────────────────────────────────────
// detectLanguage
// ─────────────────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("detects JavaScript", () => {
    assert.equal(detectLanguage("src/index.js"), "javascript");
    assert.equal(detectLanguage("src/app.jsx"), "javascript");
    assert.equal(detectLanguage("src/config.mjs"), "javascript");
  });

  it("detects TypeScript", () => {
    assert.equal(detectLanguage("src/index.ts"), "typescript");
    assert.equal(detectLanguage("src/App.tsx"), "typescript");
  });

  it("detects Python", () => {
    assert.equal(detectLanguage("main.py"), "python");
  });

  it("detects Go", () => {
    assert.equal(detectLanguage("main.go"), "go");
  });

  it("detects Rust", () => {
    assert.equal(detectLanguage("main.rs"), "rust");
  });

  it("detects Dockerfile by basename", () => {
    assert.equal(detectLanguage("Dockerfile"), "dockerfile");
  });

  it("detects Makefile by basename", () => {
    assert.equal(detectLanguage("Makefile"), "makefile");
  });

  it("falls back to text for unknown extensions", () => {
    assert.equal(detectLanguage("file.xyz"), "text");
  });
});

// ─────────────────────────────────────────────────────────────────
// containsNullByte
// ─────────────────────────────────────────────────────────────────

describe("containsNullByte", () => {
  it("returns true for buffer with null bytes", () => {
    const buf = Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6f]);
    assert.ok(containsNullByte(buf, buf.length));
  });

  it("returns false for text-only buffer", () => {
    const buf = Buffer.from("Hello, world!", "utf8");
    assert.ok(!containsNullByte(buf, buf.length));
  });

  it("returns false for empty buffer", () => {
    const buf = Buffer.alloc(0);
    assert.ok(!containsNullByte(buf, 0));
  });
});

// ─────────────────────────────────────────────────────────────────
// readFileHandler — integration tests with real filesystem
// ─────────────────────────────────────────────────────────────────

describe("readFileHandler", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("reads a text file with line numbers", async () => {
    await createFile("src/hello.js", 'const x = 1;\nconst y = 2;\nconsole.log(x + y);\n');

    const result = await readFileHandler(
      { path: "src/hello.js" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("src/hello.js"));
    assert.ok(result.output.includes("1: const x = 1;"));
    assert.ok(result.output.includes("2: const y = 2;"));
    assert.ok(result.output.includes("3: console.log(x + y);"));
    assert.ok(result.output.includes("javascript"));
  });

  it("includes file metadata (size, line count, language)", async () => {
    await createFile("README.md", "# Hello\n\nThis is a readme.\n");

    const result = await readFileHandler(
      { path: "README.md" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("README.md"));
    assert.ok(result.output.includes("markdown"));
    assert.ok(result.output.includes("lines"));
  });

  it("returns error for non-existent file", async () => {
    const result = await readFileHandler(
      { path: "does-not-exist.js" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("not found"));
  });

  it("returns error for directories", async () => {
    await mkdir(path.join(tmpDir, "src/services"), { recursive: true });

    const result = await readFileHandler(
      { path: "src/services" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("directory"));
  });

  it("detects and rejects binary files", async () => {
    const binaryContent = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    await createFile("image.png", binaryContent);

    const result = await readFileHandler(
      { path: "image.png" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Binary file]"));
    assert.ok(result.output.includes("cannot display"));
  });

  it("truncates files exceeding 100KB", async () => {
    // Create a file larger than 100KB
    const bigContent = "x".repeat(110_000) + "\n";
    await createFile("big-file.txt", bigContent);

    const result = await readFileHandler(
      { path: "big-file.txt" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Truncated]"));
    assert.ok(result.output.includes("100KB"));
  });

  it("respects ignore patterns", async () => {
    await createFile("node_modules/foo/index.js", "module.exports = {};");

    const mockIgnore = createMockIgnore(["node_modules"]);
    const result = await readFileHandler(
      { path: "node_modules/foo/index.js" },
      { cwd: tmpDir, fortifyIgnore: mockIgnore },
    );

    assert.ok(result.output.includes("[Ignored]"));
  });

  it("rejects path traversal attempts", async () => {
    await assert.rejects(
      async () =>
        readFileHandler(
          { path: "../../etc/passwd" },
          { cwd: tmpDir },
        ),
      /outside the project root/i,
    );
  });

  it("handles empty files", async () => {
    await createFile("empty.txt", "");

    const result = await readFileHandler(
      { path: "empty.txt" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("empty.txt"));
    assert.ok(result.output.includes("1 lines"));
  });

  it("normalizes Windows line endings", async () => {
    await createFile("crlf.txt", "line1\r\nline2\r\nline3\r\n");

    const result = await readFileHandler(
      { path: "crlf.txt" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("1: line1"));
    assert.ok(result.output.includes("2: line2"));
    assert.ok(result.output.includes("3: line3"));
    // Should not contain \r in the output
    assert.ok(!result.output.includes("\r"));
  });

  it("works with nested directory paths", async () => {
    await createFile(
      "src/services/deep/nested/file.ts",
      "export const x = 1;\n",
    );

    const result = await readFileHandler(
      { path: "src/services/deep/nested/file.ts" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("src/services/deep/nested/file.ts"));
    assert.ok(result.output.includes("typescript"));
    assert.ok(result.output.includes("1: export const x = 1;"));
  });

  it("reads files without FortifyIgnore (optional dependency)", async () => {
    await createFile("standalone.js", "const a = 1;\n");

    // No fortifyIgnore passed — should still work
    const result = await readFileHandler(
      { path: "standalone.js" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("standalone.js"));
    assert.ok(result.output.includes("1: const a = 1;"));
  });
});
