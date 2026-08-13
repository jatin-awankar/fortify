import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_HANDLERS,
  registerAllHandlers,
  getRegisteredToolNames,
} from "../src/tools/index.js";

// ─────────────────────────────────────────────────────────────────
// TOOL_HANDLERS map
// ─────────────────────────────────────────────────────────────────

describe("TOOL_HANDLERS", () => {
  it("exports all 6 tool handlers", () => {
    assert.equal(Object.keys(TOOL_HANDLERS).length, 6);
  });

  const expectedTools = [
    "read_file",
    "write_file",
    "edit_file",
    "execute_command",
    "search_files",
    "list_directory",
  ];

  for (const name of expectedTools) {
    it(`has handler for '${name}'`, () => {
      assert.ok(TOOL_HANDLERS[name], `Missing handler: ${name}`);
      assert.equal(typeof TOOL_HANDLERS[name], "function");
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// getRegisteredToolNames
// ─────────────────────────────────────────────────────────────────

describe("getRegisteredToolNames", () => {
  it("returns all tool names", () => {
    const names = getRegisteredToolNames();
    assert.equal(names.length, 6);
    assert.ok(names.includes("read_file"));
    assert.ok(names.includes("write_file"));
    assert.ok(names.includes("edit_file"));
    assert.ok(names.includes("execute_command"));
    assert.ok(names.includes("search_files"));
    assert.ok(names.includes("list_directory"));
  });
});

// ─────────────────────────────────────────────────────────────────
// registerAllHandlers
// ─────────────────────────────────────────────────────────────────

describe("registerAllHandlers", () => {
  /** Minimal mock ToolExecutor to verify registration. */
  function createMockExecutor(knownTools) {
    const registered = new Map();
    return {
      registered,
      registerHandler(name, handler) {
        if (knownTools && !knownTools.includes(name)) {
          throw new Error(`Cannot register handler: tool '${name}' not found in registry.`);
        }
        registered.set(name, handler);
      },
    };
  }

  it("registers all handlers on the executor", () => {
    const executor = createMockExecutor();
    registerAllHandlers(executor);

    assert.equal(executor.registered.size, 6);
    assert.ok(executor.registered.has("read_file"));
    assert.ok(executor.registered.has("write_file"));
    assert.ok(executor.registered.has("execute_command"));
  });

  it("supports 'only' filter", () => {
    const executor = createMockExecutor();
    registerAllHandlers(executor, { only: ["read_file", "search_files"] });

    assert.equal(executor.registered.size, 2);
    assert.ok(executor.registered.has("read_file"));
    assert.ok(executor.registered.has("search_files"));
    assert.ok(!executor.registered.has("write_file"));
  });

  it("supports 'exclude' filter", () => {
    const executor = createMockExecutor();
    registerAllHandlers(executor, { exclude: ["execute_command"] });

    assert.equal(executor.registered.size, 5);
    assert.ok(!executor.registered.has("execute_command"));
    assert.ok(executor.registered.has("read_file"));
  });

  it("skips tools not in registry without throwing", () => {
    const executor = createMockExecutor(["read_file", "write_file"]);

    // Should not throw even though other tools aren't in the mock registry
    assert.doesNotThrow(() => {
      registerAllHandlers(executor);
    });

    assert.equal(executor.registered.size, 2);
  });
});
