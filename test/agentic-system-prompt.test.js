import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgenticSystemPrompt } from "../src/config/agentic-system-prompt.js";

describe("buildAgenticSystemPrompt", () => {
  const basePrompt = "You are Fortify.\n\n[Project Context]\nName: my-app\nStack: Node.js";
  const toolSummary = [
    "Available tools:",
    "  - read_file(path*): Read the contents of a file from the workspace",
    "  - write_file(path*, content*): Create or overwrite a file in the workspace [requires permission]",
    "  - execute_command(command*, cwd): Run a shell command in the workspace [requires permission]",
  ].join("\n");

  it("includes the base prompt", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("You are Fortify."));
    assert.ok(result.includes("[Project Context]"));
    assert.ok(result.includes("my-app"));
  });

  it("includes the agentic mode marker", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("[Agentic Mode]"));
  });

  it("includes the tool summary", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("Available tools:"));
    assert.ok(result.includes("read_file"));
    assert.ok(result.includes("write_file"));
    assert.ok(result.includes("execute_command"));
  });

  it("includes tool-use guidelines", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("Read before you write"));
    assert.ok(result.includes("targeted edits"));
    assert.ok(result.includes("Verify your work"));
  });

  it("includes the working directory when provided", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary, cwd: "/home/user/project" });
    assert.ok(result.includes("Working Directory: /home/user/project"));
  });

  it("omits working directory when cwd is not provided", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(!result.includes("Working Directory:"));
  });

  it("includes file operation descriptions", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("File Operations"));
    assert.ok(result.includes("Command Execution"));
  });

  it("includes command execution safety notes", () => {
    const result = buildAgenticSystemPrompt({ basePrompt, toolSummary });
    assert.ok(result.includes("30-second timeout"));
    assert.ok(result.includes("user permission"));
    assert.ok(result.includes("Dangerous commands"));
  });
});
