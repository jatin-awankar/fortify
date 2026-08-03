import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ToolExecutor } from "../src/services/tool-executor.js";
import { ToolRegistry } from "../src/services/tool-registry.js";
import { PERMISSION_RESPONSE } from "../src/renderers/permission-prompt.js";

function createMockStdout() {
  const chunks = [];
  return {
    chunks,
    isTTY: false,
    columns: 80,
    write(data) { chunks.push(data); return true; },
    get output() { return chunks.join(""); },
    clear() { chunks.length = 0; },
  };
}

function createMockPermissionPrompt(autoResponse = PERMISSION_RESPONSE.ALLOW) {
  return {
    requestPermission: async () => autoResponse,
    isAllowedAll: () => false,
    confirmAction: async () => autoResponse === PERMISSION_RESPONSE.ALLOW,
  };
}

describe("ToolExecutor", () => {
  let stdout;
  let registry;
  let executor;

  beforeEach(() => {
    stdout = createMockStdout();
    registry = new ToolRegistry();
    executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: createMockPermissionPrompt(),
      stdout,
      env: { NO_COLOR: "1" },
    });
  });

  describe("scaffold mode (no handlers)", () => {
    it("executes a read_file call in scaffold mode", async () => {
      const result = await executor.execute({
        name: "read_file",
        arguments: { path: "src/index.js" },
      });

      assert.ok(result.success);
      assert.ok(result.output.includes("Scaffold"));
      assert.ok(result.output.includes("read_file"));
      assert.equal(result.toolName, "read_file");
      assert.ok(result.durationMs >= 0);
    });

    it("handles unknown tool gracefully", async () => {
      const result = await executor.execute({
        name: "nonexistent_tool",
        arguments: {},
      });

      assert.ok(!result.success);
      assert.ok(result.error.includes("Unknown tool"));
    });

    it("tracks execution statistics", async () => {
      await executor.execute({ name: "read_file", arguments: { path: "a.js" } });
      await executor.execute({ name: "search_files", arguments: { query: "test" } });

      const stats = executor.getStats();
      assert.equal(stats.totalCalls, 2);
      assert.equal(stats.successCount, 2);
      assert.equal(stats.errorCount, 0);
    });
  });

  describe("with registered handler", () => {
    it("calls the handler and returns its output", async () => {
      executor.registerHandler("read_file", async (params) => {
        return { output: `Contents of ${params.path}` };
      });

      const result = await executor.execute({
        name: "read_file",
        arguments: { path: "package.json" },
      });

      assert.ok(result.success);
      assert.equal(result.output, "Contents of package.json");
    });

    it("handles string return from handler", async () => {
      executor.registerHandler("read_file", async () => "file content");

      const result = await executor.execute({
        name: "read_file",
        arguments: { path: "test.txt" },
      });

      assert.ok(result.success);
      assert.equal(result.output, "file content");
    });

    it("catches handler errors", async () => {
      executor.registerHandler("read_file", async () => {
        throw new Error("File not found");
      });

      const result = await executor.execute({
        name: "read_file",
        arguments: { path: "missing.txt" },
      });

      assert.ok(!result.success);
      assert.equal(result.error, "File not found");
    });

    it("throws when registering handler for unknown tool", () => {
      assert.throws(
        () => executor.registerHandler("nonexistent", async () => {}),
        /not found in registry/
      );
    });
  });

  describe("permission checks", () => {
    it("allows read_file without permission prompt (not required)", async () => {
      let permissionCalled = false;
      const execWithPerm = new ToolExecutor({
        toolRegistry: registry,
        permissionPrompt: {
          requestPermission: async () => {
            permissionCalled = true;
            return PERMISSION_RESPONSE.ALLOW;
          },
        },
        stdout,
        env: { NO_COLOR: "1" },
      });

      await execWithPerm.execute({ name: "read_file", arguments: { path: "a.js" } });
      assert.ok(!permissionCalled, "read_file should not prompt for permission");
    });

    it("prompts for permission on write_file", async () => {
      let permissionCalled = false;
      const execWithPerm = new ToolExecutor({
        toolRegistry: registry,
        permissionPrompt: {
          requestPermission: async () => {
            permissionCalled = true;
            return PERMISSION_RESPONSE.ALLOW;
          },
        },
        stdout,
        env: { NO_COLOR: "1" },
      });

      await execWithPerm.execute({
        name: "write_file",
        arguments: { path: "out.js", content: "hello" },
      });

      assert.ok(permissionCalled, "write_file should prompt for permission");
    });

    it("skips execution when permission denied", async () => {
      const execDenied = new ToolExecutor({
        toolRegistry: registry,
        permissionPrompt: createMockPermissionPrompt(PERMISSION_RESPONSE.DENY),
        stdout,
        env: { NO_COLOR: "1" },
      });

      const result = await execDenied.execute({
        name: "execute_command",
        arguments: { command: "rm -rf /" },
      });

      assert.ok(!result.success);
      assert.ok(result.error.includes("Permission denied"));

      const stats = execDenied.getStats();
      assert.equal(stats.deniedCount, 1);
    });
  });

  describe("executeAll", () => {
    it("executes multiple tool calls sequentially", async () => {
      const results = await executor.executeAll([
        { name: "read_file", arguments: { path: "a.js" } },
        { name: "search_files", arguments: { query: "TODO" } },
        { name: "list_directory", arguments: { path: "." } },
      ]);

      assert.equal(results.length, 3);
      assert.ok(results.every((r) => r.success));
    });

    it("renders step headers for multiple calls", async () => {
      await executor.executeAll([
        { name: "read_file", arguments: { path: "a.js" } },
        { name: "read_file", arguments: { path: "b.js" } },
      ]);

      assert.ok(stdout.output.includes("[1/2]"));
      assert.ok(stdout.output.includes("[2/2]"));
    });
  });

  describe("resetStats", () => {
    it("resets all stats to zero", async () => {
      await executor.execute({ name: "read_file", arguments: { path: "a.js" } });
      executor.resetStats();
      const stats = executor.getStats();
      assert.equal(stats.totalCalls, 0);
      assert.equal(stats.successCount, 0);
    });
  });
});
