import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { SlashCommandHandler } from "../src/renderers/slash-command-handler.js";

function createMockStdout() {
  const chunks = [];
  return {
    chunks,
    isTTY: true,
    columns: 80,
    write(data) { chunks.push(data); return true; },
    get output() { return chunks.join(""); },
    clear() { chunks.length = 0; },
  };
}

function createMockRenderer(stdout) {
  return {
    terminalUI: {
      stdout,
      chalk: {
        bold: Object.assign((t) => t, { cyan: (t) => t }),
        cyan: (t) => t,
        dim: (t) => t,
        green: (t) => t,
        yellow: (t) => t,
        red: (t) => t,
      },
      success: () => {},
      info: () => {},
      error: () => {},
    },
    messageRenderer: {
      renderInfo: (msg) => stdout.write(`INFO: ${msg}\n`),
      renderWarning: (msg) => stdout.write(`WARN: ${msg}\n`),
      renderError: (msg) => stdout.write(`ERR: ${msg}\n`),
    },
    statusBar: {
      render: () => stdout.write("STATUS_BAR_RENDERED\n"),
    },
  };
}

function createMockConversationStore() {
  const sessions = new Map();
  return {
    getOrCreateSession(id) {
      if (!sessions.has(id)) sessions.set(id, { id, messages: [] });
      return sessions.get(id);
    },
    getSession(id) { return sessions.get(id); },
    clearSession(id) {
      if (sessions.has(id)) sessions.get(id).messages = [];
    },
    addMessage(id, msg) {
      if (!sessions.has(id)) this.getOrCreateSession(id);
      sessions.get(id).messages.push(msg);
    },
  };
}

describe("SlashCommandHandler", () => {
  let handler;
  let stdout;
  let renderer;
  let store;

  beforeEach(() => {
    handler = new SlashCommandHandler();
    stdout = createMockStdout();
    renderer = createMockRenderer(stdout);
    store = createMockConversationStore();
    store.getOrCreateSession("test-session");
  });

  describe("isSlashCommand", () => {
    it("identifies slash commands", () => {
      assert.ok(handler.isSlashCommand("/help"));
      assert.ok(handler.isSlashCommand("/clear"));
      assert.ok(handler.isSlashCommand("/model gpt-4o"));
      assert.ok(handler.isSlashCommand("/exit"));
    });

    it("rejects non-slash-commands", () => {
      assert.ok(!handler.isSlashCommand("hello"));
      assert.ok(!handler.isSlashCommand(""));
      assert.ok(!handler.isSlashCommand(null));
      assert.ok(!handler.isSlashCommand("/nonexistent"));
    });

    it("identifies aliases", () => {
      assert.ok(handler.isSlashCommand("/?"));
      assert.ok(handler.isSlashCommand("/quit"));
      assert.ok(handler.isSlashCommand("/bye"));
    });
  });

  describe("execute", () => {
    it("returns true for known commands", async () => {
      const result = await handler.execute("/help", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });
      assert.ok(result);
    });

    it("returns false for unknown commands", async () => {
      const result = await handler.execute("/nonexistent", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });
      assert.ok(!result);
    });

    it("returns false for non-slash input", async () => {
      const result = await handler.execute("hello world", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });
      assert.ok(!result);
    });
  });

  describe("/help", () => {
    it("lists available commands", async () => {
      await handler.execute("/help", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });

      assert.ok(stdout.output.includes("/help"), "Should list /help");
      assert.ok(stdout.output.includes("/clear"), "Should list /clear");
      assert.ok(stdout.output.includes("/model"), "Should list /model");
      assert.ok(stdout.output.includes("/exit"), "Should list /exit");
    });

    it("works via alias /?", async () => {
      const result = await handler.execute("/?", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });
      assert.ok(result);
      assert.ok(stdout.output.includes("Available Commands"));
    });
  });

  describe("/clear", () => {
    it("clears conversation history", async () => {
      store.addMessage("test-session", { role: "user", content: "hello" });
      store.addMessage("test-session", { role: "assistant", content: "hi" });

      await handler.execute("/clear", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });

      const session = store.getSession("test-session");
      assert.equal(session.messages.length, 0);
    });
  });

  describe("/model", () => {
    it("shows current model when no arg provided", async () => {
      await handler.execute("/model", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
        currentModel: "gpt-4o",
        currentProvider: "openai",
      });

      assert.ok(stdout.output.includes("gpt-4o"));
    });

    it("calls onModelChange when model arg provided", async () => {
      let changedTo = null;

      await handler.execute("/model claude-3.5-sonnet", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
        currentModel: "gpt-4o",
        onModelChange: (m) => { changedTo = m; },
      });

      assert.equal(changedTo, "claude-3.5-sonnet");
    });
  });

  describe("/exit", () => {
    it("calls requestExit", async () => {
      let exited = false;

      await handler.execute("/exit", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
        requestExit: () => { exited = true; },
      });

      assert.ok(exited, "Should have called requestExit");
    });

    it("works via /quit alias", async () => {
      let exited = false;

      await handler.execute("/quit", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
        requestExit: () => { exited = true; },
      });

      assert.ok(exited);
    });
  });

  describe("/history", () => {
    it("shows recent messages", async () => {
      store.addMessage("test-session", { role: "user", content: "What is Node.js?" });
      store.addMessage("test-session", { role: "assistant", content: "Node.js is a runtime..." });

      await handler.execute("/history", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });

      assert.ok(stdout.output.includes("What is Node.js?"));
      assert.ok(stdout.output.includes("Node.js is a runtime"));
    });

    it("shows 'no messages' for empty session", async () => {
      await handler.execute("/history", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });

      assert.ok(stdout.output.includes("No messages"));
    });
  });

  describe("/status", () => {
    it("renders the status bar", async () => {
      await handler.execute("/status", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });

      assert.ok(stdout.output.includes("STATUS_BAR_RENDERED"));
    });
  });

  describe("/context", () => {
    it("shows project context summary", async () => {
      const mockPcs = {
        cwd: "/test/dir",
        getProjectContextSummary: async () => ({
          name: "test-app",
          stack: ["Node.js"],
          instructions: "Test instructions",
          hasMemory: true,
          git: { branch: "main", remoteUrl: "origin" }
        })
      };

      await handler.execute("/context", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
        projectContextService: mockPcs
      });

      assert.ok(stdout.output.includes("Project Context"));
      assert.ok(stdout.output.includes("test-app"));
      assert.ok(stdout.output.includes("Node.js"));
      assert.ok(stdout.output.includes("Test instructions"));
      assert.ok(stdout.output.includes("active")); // memory status
      assert.ok(stdout.output.includes("main")); // branch
    });
  });

  describe("/repo-map", () => {
    it("generates repo map from cwd", async () => {
      await handler.execute("/repo-map 5", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });

      assert.ok(stdout.output.includes("[Repository Map]"));
    });

    it("resolves /map alias to /repo-map", () => {
      assert.ok(handler.isSlashCommand("/map"), "/map should be a valid alias");
    });
  });

  describe("/memory", () => {
    it("shows no memory message when empty", async () => {
      const nonexistentCwd = path.join(os.tmpdir(), "fortify-nonexistent-dir-for-test");
      await handler.execute("/memory", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
        projectContextService: { cwd: nonexistentCwd }
      });

      assert.ok(stdout.output.includes("No project memory entries"));
    });

    it("shows usage hint when /memory add has no text", async () => {
      const nonexistentCwd = path.join(os.tmpdir(), "fortify-nonexistent-dir-for-test");
      await handler.execute("/memory add", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
        projectContextService: { cwd: nonexistentCwd }
      });

      assert.ok(stdout.output.includes("Usage: /memory add"), "Should show usage hint");
    });
  });

  describe("custom commands", () => {
    it("registers and executes custom commands", async () => {
      let customCalled = false;

      const customHandler = new SlashCommandHandler({
        customCommands: [{
          name: "/deploy",
          description: "Deploy the project",
          aliases: [],
          handler: async () => { customCalled = true; },
        }],
      });

      assert.ok(customHandler.isSlashCommand("/deploy"));

      await customHandler.execute("/deploy", {
        renderer,
        conversationStore: store,
        session: { id: "test-session" },
      });

      assert.ok(customCalled);
    });
  });

  describe("getCommandNames", () => {
    it("returns all command names including aliases", () => {
      const names = handler.getCommandNames();
      assert.ok(names.includes("/help"));
      assert.ok(names.includes("/?"));
      assert.ok(names.includes("/exit"));
      assert.ok(names.includes("/quit"));
      assert.ok(names.includes("/bye"));
    });
  });
});
