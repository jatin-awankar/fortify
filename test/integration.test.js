import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Renderers
import { ToolUseCard, CARD_STATUS, TOOL_TYPES } from "../src/renderers/tool-use-card.js";
import { PermissionPrompt, PERMISSION_RESPONSE } from "../src/renderers/permission-prompt.js";
import { MessageRenderer } from "../src/renderers/message-renderer.js";
import { StatusBar } from "../src/renderers/status-bar.js";
import { ThinkingIndicator } from "../src/renderers/thinking-indicator.js";
import { SlashCommandHandler } from "../src/renderers/slash-command-handler.js";
import { InputHistory } from "../src/renderers/prompt-editor.js";
import { stripAnsi } from "../src/renderers/ansi-style.js";
import { TerminalUI } from "../src/renderers/terminal-ui.js";

// Services
import { ToolRegistry, PERMISSION_LEVEL } from "../src/services/tool-registry.js";
import { ToolExecutor } from "../src/services/tool-executor.js";
import { AgenticLoop } from "../src/services/agentic-loop.js";

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

describe("Integration: Full Agentic Pipeline", () => {
  let stdout;
  let registry;
  let executor;
  let loop;

  beforeEach(() => {
    stdout = createMockStdout();
    registry = new ToolRegistry();
    executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async () => PERMISSION_RESPONSE.ALLOW,
      },
      stdout,
      env: { NO_COLOR: "1" },
    });
    loop = new AgenticLoop({
      toolRegistry: registry,
      toolExecutor: executor,
    });
  });

  it("simulates a full read → edit → verify agentic flow", async () => {
    // Register real-ish handlers
    executor.registerHandler("read_file", async (params) => ({
      output: `// Contents of ${params.path}\nconst x = 1;\nconst y = 2;\n`,
    }));
    executor.registerHandler("search_files", async (params) => ({
      output: `src/config.js:3: ${params.query}\nsrc/utils.js:12: ${params.query}\n`,
    }));

    let turn = 0;
    const result = await loop.run({
      messages: [{ role: "user", content: "Find all TODO comments and show me the files" }],
      sendToLLM: async () => {
        turn++;
        if (turn === 1) {
          return {
            text: "Let me search for TODO comments.",
            toolCalls: [
              { id: "call_1", name: "search_files", arguments: { query: "TODO" } },
            ],
          };
        }
        if (turn === 2) {
          return {
            text: "",
            toolCalls: [
              { id: "call_2", name: "read_file", arguments: { path: "src/config.js" } },
            ],
          };
        }
        return {
          text: "I found TODO comments in 2 files:\n- src/config.js (line 3)\n- src/utils.js (line 12)",
          toolCalls: [],
        };
      },
    });

    // Verify loop completed correctly
    assert.equal(result.iterations, 3);
    assert.equal(result.toolResults.length, 2);
    assert.ok(result.toolResults[0].success, "search_files should succeed");
    assert.ok(result.toolResults[1].success, "read_file should succeed");
    assert.ok(result.text.includes("TODO comments"), "Final text should summarize findings");
    assert.ok(!result.aborted);

    // Verify tool cards were rendered
    const output = stripAnsi(stdout.output);
    assert.ok(output.includes("TODO"), "Should render search query");
    assert.ok(output.includes("src/config.js"), "Should render file path");
  });

  it("permission denial stops tool execution in the pipeline", async () => {
    const deniedExecutor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: {
        requestPermission: async ({ toolType }) => {
          return toolType === "execute_command"
            ? PERMISSION_RESPONSE.DENY
            : PERMISSION_RESPONSE.ALLOW;
        },
      },
      stdout,
      env: { NO_COLOR: "1" },
    });

    const deniedLoop = new AgenticLoop({
      toolRegistry: registry,
      toolExecutor: deniedExecutor,
    });

    let turn = 0;
    const result = await deniedLoop.run({
      messages: [{ role: "user", content: "Run npm test" }],
      sendToLLM: async () => {
        turn++;
        if (turn === 1) {
          return {
            text: "",
            toolCalls: [
              { id: "c1", name: "execute_command", arguments: { command: "npm test" } },
            ],
          };
        }
        return {
          text: "The command was denied. Would you like me to try something else?",
          toolCalls: [],
        };
      },
    });

    assert.equal(result.toolResults.length, 1);
    assert.ok(!result.toolResults[0].success, "Denied tool should not succeed");
    assert.ok(result.toolResults[0].error.includes("Permission denied"));
    assert.ok(result.text.includes("denied"));
  });
});

describe("Integration: Slash Commands + StatusBar + MessageRenderer", () => {
  let stdout;
  let terminalUI;

  beforeEach(() => {
    stdout = createMockStdout();
    terminalUI = new TerminalUI({ stdout, env: { NO_COLOR: "1" } });
  });

  it("MessageRenderer + ThinkingIndicator lifecycle", () => {
    const renderer = new MessageRenderer({ terminalUI });

    // Start thinking
    const indicator = renderer.showThinking();
    assert.ok(indicator.isActive);

    // Stop thinking (simulates stream starting)
    renderer.stopThinking();
    assert.ok(!indicator.isActive);

    // Render assistant label
    renderer.renderAssistantLabel();
    const output = stripAnsi(stdout.output);
    assert.ok(output.includes("Assistant"));
  });

  it("StatusBar tracks usage across multiple turns", () => {
    const bar = new StatusBar({ stdout, env: { NO_COLOR: "1" } });

    bar.update({ model: "gpt-4o", provider: "openai" });
    bar.addUsage({ promptTokens: 100, completionTokens: 50, estimatedCost: 0.002 });
    bar.addUsage({ promptTokens: 200, completionTokens: 80, estimatedCost: 0.004 });

    bar.renderTurnSummary();

    const output = stripAnsi(stdout.output);
    assert.ok(output.includes("300") || output.includes("↑"), "Should show cumulative prompt tokens");
  });

  it("/tools command lists available tools", async () => {
    const handler = new SlashCommandHandler();
    const registry = new ToolRegistry();

    const result = await handler.execute("/tools", {
      renderer: { terminalUI, messageRenderer: { renderInfo: () => {} } },
      conversationStore: { getSession: () => null },
      session: { id: "test" },
      toolRegistry: registry,
    });

    assert.ok(result, "/tools should be handled");
    const output = stripAnsi(stdout.output);
    assert.ok(output.includes("Available Tools"), "Should show header");
    assert.ok(output.includes("read_file"), "Should list read_file");
    assert.ok(output.includes("execute_command"), "Should list execute_command");
  });

  it("InputHistory preserves draft during navigation", () => {
    const history = new InputHistory();
    history.push("first command");
    history.push("second command");

    // Navigate up from draft
    const prev = history.previous("my current text");
    assert.equal(prev, "second command");

    // Navigate further
    assert.equal(history.previous(), "first command");

    // Navigate back to draft
    history.next();
    const draft = history.next();
    assert.equal(draft, "my current text", "Draft should be preserved");
  });

  it("ToolUseCard + ToolExecutor card rendering pipeline", async () => {
    const registry = new ToolRegistry();
    const executor = new ToolExecutor({
      toolRegistry: registry,
      permissionPrompt: { requestPermission: async () => PERMISSION_RESPONSE.ALLOW },
      stdout,
      env: { NO_COLOR: "1" },
    });

    executor.registerHandler("read_file", async (params) => `Content of ${params.path}`);

    const result = await executor.execute({
      name: "read_file",
      arguments: { path: "README.md" },
    });

    assert.ok(result.success);
    assert.equal(result.output, "Content of README.md");
    assert.ok(result.durationMs >= 0);

    const output = stripAnsi(stdout.output);
    assert.ok(output.includes("README.md"), "Tool card should show file path");
  });

  it("AgenticLoop.parseResponse handles malformed JSON arguments", () => {
    const parsed = AgenticLoop.parseResponse({
      choices: [{
        message: {
          content: "response",
          tool_calls: [{
            id: "c1",
            function: {
              name: "read_file",
              arguments: "invalid json{{{",
            },
          }],
        },
      }],
    });

    assert.equal(parsed.text, "response");
    assert.equal(parsed.toolCalls.length, 1);
    assert.equal(parsed.toolCalls[0].name, "read_file");
    assert.equal(parsed.toolCalls[0].arguments, "invalid json{{{", "Should fallback to raw string");
  });
});
