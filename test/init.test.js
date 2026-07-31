import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { InitService } from "../src/services/init-service.js";

class MockProjectContextService {
  constructor({ cwd = "workspace", config = null, stack = ["Node.js"] } = {}) {
    this.cwd = cwd;
    this.config = config;
    this.stack = stack;
    this.savedConfig = null;
  }
  async loadProjectConfig() {
    return this.config;
  }
  async detectStack() {
    return this.stack;
  }
  async saveProjectConfig(config) {
    this.savedConfig = config;
  }
  getProjectConfigPath() {
    return path.join(this.cwd, ".fortify", "project.json");
  }
}

function createInitService({ gitignoreContent = "", projectConfig = null, isInteractive = false, questions = {} } = {}) {
  let writtenGitignore = null;
  
  const mockFs = {
    readFile: async () => {
      if (gitignoreContent === null) {
        const err = new Error("ENOENT");
        err.code = "ENOENT";
        throw err;
      }
      return gitignoreContent;
    },
    appendFile: async (filePath, data) => {
      writtenGitignore = data;
    }
  };

  const projectContextService = new MockProjectContextService({ config: projectConfig });
  
  const stdout = { write: () => {} };
  const mockTerminalUI = {
    capabilities: { isInteractive },
    divider: () => {},
    info: () => {},
    success: () => {},
    error: () => {},
    warning: () => {},
    stdout
  };

  // Mock standard stream for readline prompt
  const mockInput = {
    on: () => {},
    removeListener: () => {}
  };
  const mockOutput = {
    write: () => {}
  };

  const service = new InitService({
    projectContextService,
    terminalUI: mockTerminalUI,
    fsPromises: mockFs,
    input: mockInput,
    output: mockOutput
  });

  return { service, projectContextService, getWrittenGitignore: () => writtenGitignore };
}

test("InitService runs non-interactive flow with overrides", async () => {
  const { service, projectContextService } = createInitService({
    isInteractive: false
  });

  const result = await service.runInitFlow({ name: "my-custom-app", stack: "Rust, Go", yes: true });
  assert.equal(result.ok, true);
  assert.equal(result.name, "my-custom-app");
  assert.deepEqual(result.stack, ["Rust", "Go"]);
  
  assert.ok(projectContextService.savedConfig);
  assert.equal(projectContextService.savedConfig.name, "my-custom-app");
  assert.deepEqual(projectContextService.savedConfig.stack, ["Rust", "Go"]);
});

test("InitService updates gitignore if .fortify/ is not present", async () => {
  const { service, getWrittenGitignore } = createInitService({
    gitignoreContent: "node_modules/\n",
    isInteractive: false
  });

  const result = await service.runInitFlow({ yes: true });
  assert.equal(result.ok, true);
  assert.match(getWrittenGitignore(), /\.fortify\//);
});

test("InitService does not update gitignore if .fortify/ is already present", async () => {
  const { service, getWrittenGitignore } = createInitService({
    gitignoreContent: "node_modules/\n.fortify/\n",
    isInteractive: false
  });

  const result = await service.runInitFlow({ yes: true });
  assert.equal(result.ok, true);
  assert.equal(getWrittenGitignore(), null);
});
