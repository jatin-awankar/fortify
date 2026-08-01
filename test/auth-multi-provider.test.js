import assert from "node:assert/strict";
import test from "node:test";
import { AuthService } from "../src/services/auth-service.js";
import { ConfigService } from "../src/services/config-service.js";
import { CommandService } from "../src/services/command-service.js";

function createMockTerminalUI() {
  let output = "";
  return {
    capabilities: { isInteractive: true },
    stdin: {},
    stdout: {
      write(chunk) {
        output += chunk;
      }
    },
    chalk: {
      cyan: (str) => str,
      yellow: (str) => str,
      bold: { cyan: (str) => str }
    },
    divider() {},
    info() {},
    success() {},
    warning() {},
    error(msg) {
      output += `[ERROR] ${msg}\n`;
    },
    getOutput() {
      return output;
    }
  };
}

test("AuthService configures Gemini API key for gemini provider", async () => {
  let savedConfig = null;
  const terminalUI = createMockTerminalUI();
  const authService = new AuthService({
    terminalUI,
    configPathResolver: () => "/mock/config.json",
    configUpdater: async (update) => {
      savedConfig = update;
      return update;
    },
    secretPrompt: async () => "AIzaSyD-mock-gemini-key"
  });

  const result = await authService.authenticateProviderCredentials({ provider: "gemini" });
  assert.equal(result, true);
  assert.equal(savedConfig.provider, "gemini");
  assert.equal(savedConfig.apiKeys.gemini, "AIzaSyD-mock-gemini-key");
});

test("AuthService configures Anthropic API key for anthropic provider", async () => {
  let savedConfig = null;
  const terminalUI = createMockTerminalUI();
  const authService = new AuthService({
    terminalUI,
    configPathResolver: () => "/mock/config.json",
    configUpdater: async (update) => {
      savedConfig = update;
      return update;
    },
    secretPrompt: async () => "sk-ant-mock-anthropic-key"
  });

  const result = await authService.authenticateProviderCredentials({ provider: "anthropic" });
  assert.equal(result, true);
  assert.equal(savedConfig.provider, "anthropic");
  assert.equal(savedConfig.apiKeys.anthropic, "sk-ant-mock-anthropic-key");
});

test("ConfigService redacts openai, anthropic, and gemini secret API keys", async () => {
  const terminalUI = createMockTerminalUI();
  const mockConfig = {
    provider: "gemini",
    apiKeys: {
      openai: "sk-proj-1234567890abcdef1234",
      anthropic: "sk-ant-1234567890abcdef5678",
      gemini: "AIzaSyD1234567890abcdef9012"
    }
  };

  const configService = new ConfigService({
    terminalUI,
    configLoader: async () => mockConfig,
    configPathResolver: () => "/mock/config.json"
  });

  const res = await configService.listConfig();
  assert.equal(res.ok, true);
  assert.equal(res.config.apiKeys.openai, "sk-proj...1234");
  assert.equal(res.config.apiKeys.anthropic, "sk-ant-...5678");
  assert.equal(res.config.apiKeys.gemini, "AIzaSyD...9012");
});

test("CommandService forwards provider and model to commitService", async () => {
  let captured = null;
  const commandService = new CommandService({
    commitService: {
      runCommitFlow: async (params) => {
        captured = params;
        return { ok: true };
      }
    }
  });

  await commandService.commit({
    provider: "gemini",
    model: "gemini-1.5-pro"
  });

  assert.equal(captured.provider, "gemini");
  assert.equal(captured.model, "gemini-1.5-pro");
});

test("AuthService validateKeyFormat rejects malformed or short API keys", () => {
  const auth = new AuthService();
  assert.equal(auth.validateKeyFormat("openai", "invalid_key").valid, false);
  assert.equal(auth.validateKeyFormat("anthropic", "sk-proj-invalid").valid, false);
  assert.equal(auth.validateKeyFormat("gemini", "short").valid, false);

  assert.equal(auth.validateKeyFormat("openai", "sk-proj-1234567890abcdef1234").valid, true);
  assert.equal(auth.validateKeyFormat("anthropic", "sk-ant-1234567890abcdef5678").valid, true);
  assert.equal(auth.validateKeyFormat("gemini", "AIzaSyD1234567890abcdef9012").valid, true);
});
