import assert from "node:assert/strict";
import test from "node:test";
import { ChatService } from "../src/services/chat-service.js";

class MockProjectContextService {
  constructor({ cwd = "workspace" } = {}) {
    this.cwd = cwd;
  }
  async getProjectContextSummary() {
    return { name: "test-app", stack: ["Node.js"], instructions: "", git: null };
  }
  formatSystemPromptContext() {
    return "[Mock Project Context]";
  }
}

class MockChatSessionRenderer {
  constructor() {
    this.warnings = [];
    this.successes = [];
    this.errors = [];
    this.terminalUI = {
      success: (msg) => this.successes.push(msg),
      warning: (msg) => this.warnings.push(msg),
      error: (msg) => this.errors.push(msg),
      info: () => {}
    };
  }
  showSessionStart() {}
  showSessionEnd() {}
  showWarning(msg) {
    this.warnings.push(msg);
  }
}

function createChatService({ files = {}, limits = { maxFileRefBytes: 50, maxFileRefs: 2 }, dirEntries = [] } = {}) {
  const fsPromises = {
    stat: async (filePath) => {
      const baseName = filePath.split(/[/\\]/).pop();
      if (files[baseName] !== undefined) {
        return {
          isFile: () => true,
          size: typeof files[baseName] === "string" ? Buffer.byteLength(files[baseName]) : files[baseName].size
        };
      }
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    },
    readFile: async (filePath) => {
      const baseName = filePath.split(/[/\\]/).pop();
      const fileData = files[baseName];
      if (typeof fileData === "string") {
        return fileData;
      } else if (fileData && fileData.content) {
        return Buffer.from(fileData.content);
      }
      const err = new Error("ENOENT");
      err.code = "ENOENT";
      throw err;
    },
    readdir: async () => {
      return dirEntries.map(e => ({
        name: e.name,
        isDirectory: () => Boolean(e.isDirectory)
      }));
    }
  };

  const configLoader = async () => ({ limits });
  const projectContextService = new MockProjectContextService();
  const renderer = new MockChatSessionRenderer();

  const service = new ChatService({
    openAIService: {},
    conversationStore: {},
    historyStore: {},
    renderer,
    projectContextService,
    configLoader,
    fsPromises
  });

  return { service, renderer };
}

test("resolveFileAttachments returns same input when no file tags exist", async () => {
  const { service } = createChatService();
  const result = await service.resolveFileAttachments("hello there");
  assert.equal(result.content, "hello there");
  assert.deepEqual(result.attachments, []);
});

test("resolveFileAttachments resolves valid file references", async () => {
  const { service, renderer } = createChatService({
    files: {
      "index.js": "console.log('hello');"
    }
  });

  const result = await service.resolveFileAttachments("explain this: @index.js");
  assert.match(result.content, /explain this: @index\.js/);
  assert.match(result.content, /\[Attachment: index\.js\]/);
  assert.match(result.content, /console\.log\('hello'\);/);
  
  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].path, "index.js");
  assert.equal(result.attachments[0].content, "console.log('hello');");
  assert.equal(renderer.successes.includes("📎 Loaded file: index.js (21B)"), true);
});

test("resolveFileAttachments enforces max file size limit and warns", async () => {
  const { service, renderer } = createChatService({
    files: {
      "large.json": {
        size: 200,
        content: "x".repeat(200)
      }
    },
    limits: {
      maxFileRefBytes: 50,
      maxFileRefs: 2
    }
  });

  const result = await service.resolveFileAttachments("read @large.json");
  assert.match(result.content, /\[Warning: Content truncated after 0KB limit\]/);
  assert.equal(result.attachments[0].content.includes("truncated"), true);
  assert.equal(renderer.warnings.length > 0, true);
  assert.match(renderer.warnings[0], /exceeds configured size limit/);
});

test("resolveFileAttachments enforces max file reference count limit and warns", async () => {
  const { service, renderer } = createChatService({
    files: {
      "a.js": "const a = 1;",
      "b.js": "const b = 2;",
      "c.js": "const c = 3;"
    },
    limits: {
      maxFileRefBytes: 50,
      maxFileRefs: 2
    }
  });

  const result = await service.resolveFileAttachments("analyze @a.js @b.js @c.js");
  assert.equal(result.attachments.length, 2); // only a.js and b.js are loaded
  assert.equal(renderer.warnings.length > 0, true);
  assert.match(renderer.warnings[0], /File reference limit reached/);
});

test("autocompleteCompleter returns empty when no @ prefix is found", async () => {
  const { service } = createChatService();
  const [hits, line] = await service.autocompleteCompleter("hello world");
  assert.deepEqual(hits, []);
  assert.equal(line, "hello world");
});

test("autocompleteCompleter returns matching files/directories in CWD", async () => {
  const { service } = createChatService({
    dirEntries: [
      { name: "index.js", isDirectory: false },
      { name: "package.json", isDirectory: false },
      { name: "src", isDirectory: true }
    ]
  });

  const [hits, matched] = await service.autocompleteCompleter("explain @in");
  assert.deepEqual(hits, ["@index.js"]);
  assert.equal(matched, "@in");

  const [hits2, matched2] = await service.autocompleteCompleter("explain @s");
  assert.deepEqual(hits2, ["@src/"]);
  assert.equal(matched2, "@s");
});
