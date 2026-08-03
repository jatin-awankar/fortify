import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry, PERMISSION_LEVEL } from "../src/services/tool-registry.js";

describe("ToolRegistry", () => {
  let registry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("built-in tools", () => {
    it("registers all 6 built-in tools", () => {
      const names = registry.getNames();
      assert.ok(names.includes("read_file"));
      assert.ok(names.includes("write_file"));
      assert.ok(names.includes("edit_file"));
      assert.ok(names.includes("execute_command"));
      assert.ok(names.includes("search_files"));
      assert.ok(names.includes("list_directory"));
      assert.equal(names.length, 6);
    });

    it("each tool has name, description, parameters", () => {
      for (const tool of registry.getAll()) {
        assert.ok(tool.name, `Tool should have name`);
        assert.ok(tool.description, `${tool.name} should have description`);
        assert.ok(tool.parameters, `${tool.name} should have parameters`);
        assert.ok(tool.permissionLevel, `${tool.name} should have permissionLevel`);
      }
    });
  });

  describe("get / has", () => {
    it("returns a tool by name", () => {
      const tool = registry.get("read_file");
      assert.ok(tool);
      assert.equal(tool.name, "read_file");
    });

    it("returns null for unknown tools", () => {
      assert.equal(registry.get("nonexistent"), null);
    });

    it("has() returns true for registered tools", () => {
      assert.ok(registry.has("read_file"));
      assert.ok(!registry.has("nonexistent"));
    });
  });

  describe("register", () => {
    it("registers a custom tool", () => {
      registry.register({
        name: "deploy",
        description: "Deploy the app",
        parameters: { env: { type: "string", required: true } },
        requiresPermission: true,
        permissionLevel: PERMISSION_LEVEL.EXECUTE,
      });

      assert.ok(registry.has("deploy"));
      assert.equal(registry.get("deploy").description, "Deploy the app");
    });

    it("overrides an existing tool", () => {
      registry.register({
        name: "read_file",
        description: "Custom read",
        parameters: {},
        requiresPermission: true,
        permissionLevel: PERMISSION_LEVEL.READ,
      });

      assert.equal(registry.get("read_file").description, "Custom read");
    });

    it("throws on tool without name", () => {
      assert.throws(() => registry.register({ description: "no name" }), /name/);
      assert.throws(() => registry.register(null), /name/i);
    });
  });

  describe("requiresPermission", () => {
    it("read_file does not require permission", () => {
      assert.equal(registry.requiresPermission("read_file"), false);
    });

    it("write_file requires permission", () => {
      assert.equal(registry.requiresPermission("write_file"), true);
    });

    it("execute_command requires permission", () => {
      assert.equal(registry.requiresPermission("execute_command"), true);
    });

    it("defaults to true for unknown tools", () => {
      assert.equal(registry.requiresPermission("unknown"), true);
    });
  });

  describe("getPermissionLevel", () => {
    it("read_file has READ level", () => {
      assert.equal(registry.getPermissionLevel("read_file"), PERMISSION_LEVEL.READ);
    });

    it("write_file has WRITE level", () => {
      assert.equal(registry.getPermissionLevel("write_file"), PERMISSION_LEVEL.WRITE);
    });

    it("execute_command has EXECUTE level", () => {
      assert.equal(registry.getPermissionLevel("execute_command"), PERMISSION_LEVEL.EXECUTE);
    });

    it("unknown defaults to EXECUTE", () => {
      assert.equal(registry.getPermissionLevel("unknown"), PERMISSION_LEVEL.EXECUTE);
    });
  });

  describe("toFunctionCallingSchema", () => {
    it("generates valid schema for each tool", () => {
      const schemas = registry.toFunctionCallingSchema();
      assert.equal(schemas.length, 6);

      for (const schema of schemas) {
        assert.equal(schema.type, "function");
        assert.ok(schema.function.name);
        assert.ok(schema.function.description);
        assert.equal(schema.function.parameters.type, "object");
        assert.ok(schema.function.parameters.properties);
      }
    });

    it("marks required parameters correctly", () => {
      const schemas = registry.toFunctionCallingSchema();
      const readFile = schemas.find((s) => s.function.name === "read_file");
      assert.ok(readFile.function.parameters.required.includes("path"));
    });

    it("includes parameter descriptions", () => {
      const schemas = registry.toFunctionCallingSchema();
      const exec = schemas.find((s) => s.function.name === "execute_command");
      assert.ok(exec.function.parameters.properties.command.description);
    });
  });

  describe("toSystemPromptSummary", () => {
    it("generates a human-readable summary", () => {
      const summary = registry.toSystemPromptSummary();
      assert.ok(summary.includes("Available tools:"));
      assert.ok(summary.includes("read_file"));
      assert.ok(summary.includes("write_file"));
      assert.ok(summary.includes("[requires permission]"));
    });

    it("marks required params with asterisk", () => {
      const summary = registry.toSystemPromptSummary();
      assert.ok(summary.includes("path*"), "Required params should have asterisk");
    });
  });

  describe("PERMISSION_LEVEL constants", () => {
    it("defines all expected levels", () => {
      assert.equal(PERMISSION_LEVEL.READ, "read");
      assert.equal(PERMISSION_LEVEL.WRITE, "write");
      assert.equal(PERMISSION_LEVEL.EXECUTE, "execute");
    });
  });

  describe("custom tools via constructor", () => {
    it("accepts custom tools in constructor", () => {
      const custom = new ToolRegistry({
        customTools: [{
          name: "lint",
          description: "Run linter",
          parameters: {},
          requiresPermission: false,
          permissionLevel: PERMISSION_LEVEL.READ,
        }],
      });

      assert.ok(custom.has("lint"));
      assert.ok(custom.has("read_file"), "Built-ins should still exist");
    });
  });
});
