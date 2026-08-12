import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  editFileHandler,
  findAllOccurrences,
  findClosestMatch,
  countChangedLines,
  generateUnifiedDiff,
  formatPreview,
} from "../src/tools/edit-file-handler.js";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

let tmpDir;

async function setup() {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "fortify-edit-test-"));
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
  return fullPath;
}

async function readCreatedFile(relativePath) {
  return readFile(path.join(tmpDir, relativePath), "utf8");
}

// ─────────────────────────────────────────────────────────────────
// findAllOccurrences
// ─────────────────────────────────────────────────────────────────

describe("findAllOccurrences", () => {
  it("finds a single occurrence", () => {
    const content = "line1\nline2\nline3\n";
    const results = findAllOccurrences(content, "line2");
    assert.equal(results.length, 1);
    assert.equal(results[0].line, 2);
  });

  it("finds multiple occurrences", () => {
    const content = "foo bar\nbaz\nfoo bar\n";
    const results = findAllOccurrences(content, "foo bar");
    assert.equal(results.length, 2);
    assert.equal(results[0].line, 1);
    assert.equal(results[1].line, 3);
  });

  it("returns empty for no match", () => {
    const results = findAllOccurrences("hello world", "xyz");
    assert.equal(results.length, 0);
  });

  it("handles multi-line search strings", () => {
    const content = "aaa\nbbb\nccc\nddd\n";
    const results = findAllOccurrences(content, "bbb\nccc");
    assert.equal(results.length, 1);
    assert.equal(results[0].line, 2);
  });
});

// ─────────────────────────────────────────────────────────────────
// findClosestMatch
// ─────────────────────────────────────────────────────────────────

describe("findClosestMatch", () => {
  it("suggests a match based on the first line", () => {
    const content = "const TIMEOUT = 1000;\nconst RETRY = true;\n";
    const result = findClosestMatch(content, "const TIMEOUT = 5000;");
    assert.ok(result);
    assert.equal(result.line, 1);
    assert.ok(result.text.includes("const TIMEOUT"));
  });

  it("returns null when nothing is close", () => {
    const result = findClosestMatch("hello world", "zzzzzzzzzzzzz");
    assert.equal(result, null);
  });

  it("returns null for very short search strings", () => {
    const result = findClosestMatch("hello world", "hi");
    assert.equal(result, null);
  });
});

// ─────────────────────────────────────────────────────────────────
// countChangedLines
// ─────────────────────────────────────────────────────────────────

describe("countChangedLines", () => {
  it("reports added lines", () => {
    const result = countChangedLines("one line", "one line\nanother line");
    assert.ok(result.includes("+1"));
  });

  it("reports removed lines", () => {
    const result = countChangedLines("line1\nline2", "line1");
    assert.ok(result.includes("-1"));
  });

  it("reports no change for same line count", () => {
    const result = countChangedLines("old", "new");
    assert.ok(result.includes("±0"));
  });
});

// ─────────────────────────────────────────────────────────────────
// generateUnifiedDiff
// ─────────────────────────────────────────────────────────────────

describe("generateUnifiedDiff", () => {
  it("generates a valid unified diff", () => {
    const old = "line1\nline2\nline3\nline4\n";
    const modified = "line1\nline2_changed\nline3\nline4\n";
    const diff = generateUnifiedDiff("test.js", old, modified);

    assert.ok(diff.includes("--- a/test.js"));
    assert.ok(diff.includes("+++ b/test.js"));
    assert.ok(diff.includes("@@"));
    assert.ok(diff.includes("-line2"));
    assert.ok(diff.includes("+line2_changed"));
  });

  it("includes context lines around changes", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const oldContent = lines.join("\n");
    const newLines = [...lines];
    newLines[10] = "CHANGED_LINE";
    const newContent = newLines.join("\n");

    const diff = generateUnifiedDiff("big.js", oldContent, newContent);
    // Should include context before the change
    assert.ok(diff.includes("line8") || diff.includes("line9") || diff.includes("line10"));
    assert.ok(diff.includes("-line11"));
    assert.ok(diff.includes("+CHANGED_LINE"));
  });
});

// ─────────────────────────────────────────────────────────────────
// formatPreview
// ─────────────────────────────────────────────────────────────────

describe("formatPreview", () => {
  it("formats lines with indentation marker", () => {
    const result = formatPreview("line1\nline2", 5);
    assert.ok(result.includes("│ line1"));
    assert.ok(result.includes("│ line2"));
  });

  it("truncates with 'more lines' indicator", () => {
    const content = "a\nb\nc\nd\ne\nf\ng";
    const result = formatPreview(content, 3);
    assert.ok(result.includes("4 more lines"));
  });
});

// ─────────────────────────────────────────────────────────────────
// editFileHandler — integration tests
// ─────────────────────────────────────────────────────────────────

describe("editFileHandler", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("performs a simple single-line replacement", async () => {
    await createFile("config.js", 'const TIMEOUT = 1000;\nconst RETRY = false;\n');

    const result = await editFileHandler(
      {
        path: "config.js",
        search: "const TIMEOUT = 1000;",
        replace: "const TIMEOUT = 5000;",
      },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("Edited config.js"));
    assert.ok(result.output.includes("-const TIMEOUT = 1000;"));
    assert.ok(result.output.includes("+const TIMEOUT = 5000;"));

    const modified = await readCreatedFile("config.js");
    assert.ok(modified.includes("const TIMEOUT = 5000;"));
    assert.ok(modified.includes("const RETRY = false;"));
  });

  it("performs a multi-line replacement", async () => {
    const original = "function hello() {\n  return 'hello';\n}\n";
    await createFile("greet.js", original);

    const result = await editFileHandler(
      {
        path: "greet.js",
        search: "function hello() {\n  return 'hello';\n}",
        replace: "function hello(name) {\n  return `Hello, ${name}!`;\n}",
      },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("Edited greet.js"));

    const modified = await readCreatedFile("greet.js");
    assert.ok(modified.includes("function hello(name)"));
    assert.ok(modified.includes("Hello, ${name}!"));
  });

  it("adds new lines (insert)", async () => {
    await createFile("app.js", "const a = 1;\nconst b = 2;\n");

    const result = await editFileHandler(
      {
        path: "app.js",
        search: "const a = 1;",
        replace: "const a = 1;\nconst a2 = 1.5;",
      },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("+1"));

    const modified = await readCreatedFile("app.js");
    assert.ok(modified.includes("const a2 = 1.5;"));
  });

  it("removes lines (delete)", async () => {
    await createFile("cleanup.js", "line1\nline2\nline3\nline4\n");

    const result = await editFileHandler(
      {
        path: "cleanup.js",
        search: "line2\nline3\n",
        replace: "",
      },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("-2") || result.output.includes("Edited"));

    const modified = await readCreatedFile("cleanup.js");
    assert.ok(modified.includes("line1"));
    assert.ok(!modified.includes("line2"));
    assert.ok(!modified.includes("line3"));
    assert.ok(modified.includes("line4"));
  });

  it("returns error for non-existent file", async () => {
    const result = await editFileHandler(
      { path: "missing.js", search: "x", replace: "y" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("not found"));
  });

  it("returns error when search string is not found", async () => {
    await createFile("stable.js", "const x = 1;\n");

    const result = await editFileHandler(
      { path: "stable.js", search: "nonexistent string", replace: "y" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("not found"));
  });

  it("suggests closest match on not-found", async () => {
    await createFile("suggest.js", "const TIMEOUT = 1000;\nconst RETRY = true;\n");

    const result = await editFileHandler(
      {
        path: "suggest.js",
        search: "const TIMEOUT = 2000;",  // wrong value
        replace: "const TIMEOUT = 5000;",
      },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("Did you mean"));
    assert.ok(result.output.includes("TIMEOUT"));
  });

  it("returns error when search matches multiple locations", async () => {
    await createFile("dupes.js", "foo();\nbar();\nfoo();\nbaz();\nfoo();\n");

    const result = await editFileHandler(
      { path: "dupes.js", search: "foo();", replace: "qux();" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("3 locations"));
    assert.ok(result.output.includes("Match 1"));
    assert.ok(result.output.includes("Match 2"));
  });

  it("generates unified diff in output", async () => {
    await createFile("diff-test.js", "const x = 1;\nconst y = 2;\n");

    const result = await editFileHandler(
      { path: "diff-test.js", search: "const x = 1;", replace: "const x = 42;" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("--- a/diff-test.js"));
    assert.ok(result.output.includes("+++ b/diff-test.js"));
    assert.ok(result.output.includes("-const x = 1;"));
    assert.ok(result.output.includes("+const x = 42;"));
  });

  it("rejects empty path", async () => {
    const result = await editFileHandler(
      { path: "", search: "x", replace: "y" },
      { cwd: tmpDir },
    );
    assert.ok(result.output.includes("[Error]"));
  });

  it("rejects null search", async () => {
    const result = await editFileHandler(
      { path: "file.js", search: null, replace: "y" },
      { cwd: tmpDir },
    );
    assert.ok(result.output.includes("[Error]"));
  });

  it("rejects identical search and replace", async () => {
    const result = await editFileHandler(
      { path: "file.js", search: "same", replace: "same" },
      { cwd: tmpDir },
    );
    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("identical"));
  });

  it("rejects path traversal", async () => {
    const result = await editFileHandler(
      { path: "../../etc/passwd", search: "x", replace: "y" },
      { cwd: tmpDir },
    );
    assert.ok(result.output.includes("[Error]"));
    assert.ok(result.output.includes("outside"));
  });

  it("handles CRLF line endings in file", async () => {
    await createFile("crlf.js", "line1\r\nline2\r\nline3\r\n");

    const result = await editFileHandler(
      { path: "crlf.js", search: "line2", replace: "CHANGED" },
      { cwd: tmpDir },
    );

    assert.ok(result.output.includes("Edited crlf.js"));
    const modified = await readCreatedFile("crlf.js");
    assert.ok(modified.includes("CHANGED"));
  });

  it("preserves unrelated file content", async () => {
    const original = "// header comment\nconst a = 1;\nconst b = 2;\n// footer\n";
    await createFile("preserve.js", original);

    await editFileHandler(
      { path: "preserve.js", search: "const a = 1;", replace: "const a = 99;" },
      { cwd: tmpDir },
    );

    const modified = await readCreatedFile("preserve.js");
    assert.ok(modified.includes("// header comment"));
    assert.ok(modified.includes("const a = 99;"));
    assert.ok(modified.includes("const b = 2;"));
    assert.ok(modified.includes("// footer"));
  });
});
