import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MemoryService, createMemoryService } from "../src/services/memory-service.js";

// ──────────────────────────────────────────────
// Mock FS helpers
// ──────────────────────────────────────────────

/**
 * Create a mock fs that simulates an in-memory filesystem.
 * Tracks all calls for assertion purposes.
 */
function createMockFs({ initialFiles = {} } = {}) {
  const files = { ...initialFiles };
  const calls = [];

  return {
    calls,
    files,
    async access(filePath) {
      calls.push({ method: "access", path: filePath });
      if (!(filePath in files)) {
        const err = new Error(`ENOENT: no such file or directory, access '${filePath}'`);
        err.code = "ENOENT";
        throw err;
      }
    },
    async mkdir(dirPath, options) {
      calls.push({ method: "mkdir", path: dirPath, options });
    },
    async readFile(filePath, encoding) {
      calls.push({ method: "readFile", path: filePath, encoding });
      if (!(filePath in files)) {
        const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        err.code = "ENOENT";
        throw err;
      }
      return files[filePath];
    },
    async writeFile(filePath, content, encoding) {
      calls.push({ method: "writeFile", path: filePath, content, encoding });
      files[filePath] = content;
    },
  };
}

// ──────────────────────────────────────────────
// getMemoryPath
// ──────────────────────────────────────────────

describe("MemoryService.getMemoryPath", () => {
  it("returns correct path under .fortify directory", () => {
    const service = new MemoryService();
    const result = service.getMemoryPath("/project");
    assert.ok(result.includes(".fortify"));
    assert.ok(result.includes("memory.md"));
  });

  it("throws on undefined cwd", () => {
    const service = new MemoryService();
    assert.throws(() => service.getMemoryPath(undefined), /valid cwd/);
  });

  it("throws on null cwd", () => {
    const service = new MemoryService();
    assert.throws(() => service.getMemoryPath(null), /valid cwd/);
  });

  it("throws on empty string cwd", () => {
    const service = new MemoryService();
    assert.throws(() => service.getMemoryPath(""), /valid cwd/);
  });

  it("throws on non-string cwd", () => {
    const service = new MemoryService();
    assert.throws(() => service.getMemoryPath(42), /valid cwd/);
  });
});

// ──────────────────────────────────────────────
// loadMemory
// ──────────────────────────────────────────────

describe("MemoryService.loadMemory", () => {
  it("returns file content when file exists", async () => {
    const mockFs = createMockFs({
      initialFiles: { "/project/.fortify/memory.md": "## 2026-01-01 12:00\nSome memory" },
    });
    // We need the actual path that getMemoryPath would produce
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "## 2026-01-01 12:00\nSome memory";

    const content = await service.loadMemory("/project");
    assert.equal(content, "## 2026-01-01 12:00\nSome memory");
  });

  it("returns empty string when file does not exist", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const content = await service.loadMemory("/project");
    assert.equal(content, "");
  });

  it("propagates non-ENOENT errors", async () => {
    const mockFs = createMockFs();
    mockFs.readFile = async () => {
      const err = new Error("Permission denied");
      err.code = "EACCES";
      throw err;
    };
    const service = new MemoryService({ fsPromises: mockFs });

    await assert.rejects(
      () => service.loadMemory("/project"),
      (err) => err.code === "EACCES"
    );
  });
});

// ──────────────────────────────────────────────
// saveMemory
// ──────────────────────────────────────────────

describe("MemoryService.saveMemory", () => {
  it("creates directory and writes file", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });

    await service.saveMemory("/project", "test content");

    const memPath = service.getMemoryPath("/project");
    assert.equal(mockFs.files[memPath], "test content");

    // Check mkdir was called with recursive: true
    const mkdirCall = mockFs.calls.find((c) => c.method === "mkdir");
    assert.ok(mkdirCall);
    assert.deepEqual(mkdirCall.options, { recursive: true });
  });

  it("overwrites existing content", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "old content";

    await service.saveMemory("/project", "new content");

    assert.equal(mockFs.files[memPath], "new content");
  });
});

// ──────────────────────────────────────────────
// appendMemory
// ──────────────────────────────────────────────

describe("MemoryService.appendMemory", () => {
  it("appends a timestamped entry to empty file", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const date = new Date(2026, 0, 15, 10, 30); // 2026-01-15 10:30

    await service.appendMemory("/project", "Always use const", date);

    const memPath = service.getMemoryPath("/project");
    const content = mockFs.files[memPath];
    assert.ok(content.includes("## 2026-01-15 10:30"));
    assert.ok(content.includes("Always use const"));
  });

  it("appends to existing content without double newlines", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "## 2026-01-01 09:00\nFirst entry\n";

    const date = new Date(2026, 0, 15, 10, 30);
    await service.appendMemory("/project", "Second entry", date);

    const content = mockFs.files[memPath];
    assert.ok(content.includes("First entry"));
    assert.ok(content.includes("Second entry"));
    assert.ok(content.includes("## 2026-01-15 10:30"));
    // No triple+ newlines
    assert.ok(!content.includes("\n\n\n\n"));
  });

  it("trims the entry text", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const date = new Date(2026, 5, 1, 8, 0);

    await service.appendMemory("/project", "  padded text  ", date);

    const memPath = service.getMemoryPath("/project");
    const content = mockFs.files[memPath];
    assert.ok(content.includes("padded text"));
    assert.ok(!content.includes("  padded text  "));
  });

  it("silently returns for empty entry", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });

    await service.appendMemory("/project", "");
    await service.appendMemory("/project", "   ");
    await service.appendMemory("/project", null);
    await service.appendMemory("/project", undefined);

    // No writeFile calls should have happened
    const writeCalls = mockFs.calls.filter((c) => c.method === "writeFile");
    assert.equal(writeCalls.length, 0);
  });

  it("uses current date when no date provided", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });

    await service.appendMemory("/project", "test entry");

    const memPath = service.getMemoryPath("/project");
    const content = mockFs.files[memPath];
    // Should contain today's year at minimum
    assert.ok(content.includes(String(new Date().getFullYear())));
  });
});

// ──────────────────────────────────────────────
// clearMemory
// ──────────────────────────────────────────────

describe("MemoryService.clearMemory", () => {
  it("writes empty string to existing file", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "existing content";

    await service.clearMemory("/project");

    assert.equal(mockFs.files[memPath], "");
  });

  it("returns silently when file does not exist", async () => {
    const mockFs = createMockFs();
    // Make writeFile throw ENOENT (directory doesn't exist)
    mockFs.writeFile = async () => {
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    };
    const service = new MemoryService({ fsPromises: mockFs });

    // Should not throw
    await service.clearMemory("/project");
  });

  it("propagates non-ENOENT errors", async () => {
    const mockFs = createMockFs();
    mockFs.writeFile = async () => {
      const err = new Error("Disk full");
      err.code = "ENOSPC";
      throw err;
    };
    const service = new MemoryService({ fsPromises: mockFs });

    await assert.rejects(
      () => service.clearMemory("/project"),
      (err) => err.code === "ENOSPC"
    );
  });

  it("does not call access() before writing (no TOCTOU)", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "data";

    await service.clearMemory("/project");

    const accessCalls = mockFs.calls.filter((c) => c.method === "access");
    assert.equal(accessCalls.length, 0, "clearMemory should not call access()");
  });
});

// ──────────────────────────────────────────────
// hasMemory
// ──────────────────────────────────────────────

describe("MemoryService.hasMemory", () => {
  it("returns true when file exists", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "content";

    assert.equal(await service.hasMemory("/project"), true);
  });

  it("returns false when file does not exist", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    assert.equal(await service.hasMemory("/project"), false);
  });
});

// ──────────────────────────────────────────────
// countEntries
// ──────────────────────────────────────────────

describe("MemoryService.countEntries", () => {
  it("counts ## headings in memory file", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "## 2026-01-01 10:00\nEntry 1\n\n## 2026-01-02 11:00\nEntry 2\n\n## 2026-01-03 12:00\nEntry 3";

    assert.equal(await service.countEntries("/project"), 3);
  });

  it("returns 0 for empty file", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "";

    assert.equal(await service.countEntries("/project"), 0);
  });

  it("returns 0 when file does not exist", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    assert.equal(await service.countEntries("/project"), 0);
  });

  it("returns 1 for single entry", async () => {
    const mockFs = createMockFs();
    const service = new MemoryService({ fsPromises: mockFs });
    const memPath = service.getMemoryPath("/project");
    mockFs.files[memPath] = "## 2026-01-01 10:00\nOnly entry";

    assert.equal(await service.countEntries("/project"), 1);
  });
});

// ──────────────────────────────────────────────
// formatForPrompt
// ──────────────────────────────────────────────

describe("MemoryService.formatForPrompt", () => {
  let service;

  beforeEach(() => {
    service = new MemoryService();
  });

  it("returns content unchanged when within budget", () => {
    const content = "## 2026-01-01 10:00\nShort entry";
    const result = service.formatForPrompt(content, { maxTokens: 1000 });
    assert.equal(result, content.trim());
  });

  it("returns empty string for empty/null content", () => {
    assert.equal(service.formatForPrompt(""), "");
    assert.equal(service.formatForPrompt(null), "");
    assert.equal(service.formatForPrompt(undefined), "");
    assert.equal(service.formatForPrompt("   "), "");
  });

  it("keeps most recent entries when truncating", () => {
    const entries = [];
    for (let i = 0; i < 20; i++) {
      entries.push(`## 2026-01-${String(i + 1).padStart(2, "0")} 10:00\nEntry number ${i + 1} with some content.`);
    }
    const content = entries.join("\n\n");

    const result = service.formatForPrompt(content, { maxTokens: 100 });

    // Should contain the latest entries, not the earliest
    assert.ok(result.includes("Entry number 20"));
    // Should NOT contain the very first entry (truncated)
    assert.ok(!result.includes("Entry number 1\n"));
  });

  it("adds truncation notice when entries are dropped", () => {
    const entries = [];
    for (let i = 0; i < 20; i++) {
      entries.push(`## 2026-01-${String(i + 1).padStart(2, "0")} 10:00\nEntry ${i + 1}`);
    }
    const content = entries.join("\n\n");

    const result = service.formatForPrompt(content, { maxTokens: 60 });
    assert.ok(result.includes("[Earlier entries truncated"));
  });

  it("does NOT add truncation notice when all entries fit", () => {
    const content = "## 2026-01-01 10:00\nShort";
    const result = service.formatForPrompt(content, { maxTokens: 1000 });
    assert.ok(!result.includes("truncated"));
  });

  it("hard-truncates when single entry exceeds budget", () => {
    const longEntry = "## 2026-01-01 10:00\n" + "x".repeat(10000);

    const result = service.formatForPrompt(longEntry, { maxTokens: 50 });

    // Should include truncation notice
    assert.ok(result.includes("[Earlier entries truncated"));
    // Total should not wildly exceed budget (50 tokens * 4 chars = 200 chars)
    assert.ok(result.length <= 250, `Output too long: ${result.length} chars for 50 token budget`);
  });

  it("trims whitespace from output", () => {
    const content = "  \n## 2026-01-01 10:00\nEntry\n  ";
    const result = service.formatForPrompt(content, { maxTokens: 1000 });
    assert.ok(!result.startsWith(" "));
    assert.ok(!result.endsWith(" "));
  });
});

// ──────────────────────────────────────────────
// createMemoryService
// ──────────────────────────────────────────────

describe("createMemoryService", () => {
  it("creates an instance", () => {
    const service = createMemoryService();
    assert.ok(service instanceof MemoryService);
  });

  it("accepts custom fs", () => {
    const mockFs = createMockFs();
    const service = createMemoryService({ fsPromises: mockFs });
    assert.ok(service instanceof MemoryService);
  });
});
