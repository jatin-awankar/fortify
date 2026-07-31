import assert from "node:assert/strict";
import test from "node:test";
import { SessionStore } from "../src/storage/session-store.js";
import { ChatService } from "../src/services/chat-service.js";

class MockProjectContextService {
  constructor({ cwd = "workspace", config = null } = {}) {
    this.cwd = cwd;
    this.config = config;
    this.savedConfig = null;
  }
  async loadProjectConfig() {
    return this.config;
  }
  async detectStack() {
    return ["Node.js"];
  }
  async saveProjectConfig(config) {
    this.savedConfig = config;
  }
}

test("SessionStore setProjectRules and getProjectRules work correctly", async () => {
  const contextService = new MockProjectContextService({ config: { instructions: "Initial rule" } });
  const store = new SessionStore({ projectContextService: contextService });

  const initialRules = await store.getProjectRules();
  assert.equal(initialRules, "Initial rule");

  const updated = await store.setProjectRules("Use functional React components only.");
  assert.equal(updated.instructions, "Use functional React components only.");
  assert.ok(contextService.savedConfig);
  assert.equal(contextService.savedConfig.instructions, "Use functional React components only.");
});

test("ChatService resolves 'latest' session ID when sessionId is 'latest'", async () => {
  const mockHistoryStore = {
    listSessions: async () => [
      { id: "session-123", updatedAt: "2026-07-31T12:00:00Z" },
      { id: "session-100", updatedAt: "2026-07-31T10:00:00Z" }
    ]
  };

  const service = new ChatService({
    historyStore: mockHistoryStore,
    projectContextService: {
      getProjectContextSummary: async () => ({ name: "app", stack: ["Node.js"], instructions: "", git: null }),
      formatSystemPromptContext: () => "[Context]"
    },
    renderer: {
      terminalUI: { info() {} }
    }
  });

  const resolvedId = await service.resolveSessionId("latest");
  assert.equal(resolvedId, "session-123");
});
