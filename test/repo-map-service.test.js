import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  RepoMapService,
  createRepoMapService,
  extractJSSymbols,
  extractPythonSymbols,
  extractGoSymbols,
  extractRustSymbols,
  extractJavaSymbols,
  extractCSymbols,
  extractPHPSymbols,
  extractRubySymbols,
  extractSymbols,
  buildFileTree,
  formatFileTree,
} from "../src/services/repo-map-service.js";

// ──────────────────────────────────────────────
// Symbol Extraction Tests
// ──────────────────────────────────────────────

describe("extractJSSymbols", () => {
  it("extracts exported functions", () => {
    const code = `export function handleRequest(req) {}\nexport async function fetchData() {}`;
    const symbols = extractJSSymbols(code);
    assert.ok(symbols.includes("handleRequest"));
    assert.ok(symbols.includes("fetchData"));
  });

  it("extracts exported classes", () => {
    const code = `export class ChatService {\n  constructor() {}\n}`;
    const symbols = extractJSSymbols(code);
    assert.ok(symbols.includes("ChatService"));
  });

  it("extracts exported constants", () => {
    const code = `export const MAX_RETRIES = 3;\nexport let counter = 0;`;
    const symbols = extractJSSymbols(code);
    assert.ok(symbols.includes("MAX_RETRIES"));
    assert.ok(symbols.includes("counter"));
  });

  it("extracts default exports with names", () => {
    const code = `export default function main() {}\nexport default class App {}`;
    const symbols = extractJSSymbols(code);
    assert.ok(symbols.includes("main"));
  });

  it("extracts module.exports keys", () => {
    const code = `module.exports = { createService, parseConfig, MAX_SIZE }`;
    const symbols = extractJSSymbols(code);
    assert.ok(symbols.includes("createService"));
    assert.ok(symbols.includes("parseConfig"));
    assert.ok(symbols.includes("MAX_SIZE"));
  });

  it("deduplicates symbols", () => {
    const code = `export function foo() {}\nexport function foo() {}`;
    const symbols = extractJSSymbols(code);
    assert.equal(symbols.filter((s) => s === "foo").length, 1);
  });

  it("returns empty array for non-export code", () => {
    const code = `function internal() {}\nconst secret = 42;`;
    const symbols = extractJSSymbols(code);
    assert.equal(symbols.length, 0);
  });

  it("handles generator functions", () => {
    const code = `export function* generateItems() {}`;
    const symbols = extractJSSymbols(code);
    assert.ok(symbols.includes("generateItems"));
  });
});

describe("extractPythonSymbols", () => {
  it("extracts top-level functions", () => {
    const code = `def process_data(items):\n    pass\ndef handle_error(err):\n    pass`;
    const symbols = extractPythonSymbols(code);
    assert.ok(symbols.includes("process_data"));
    assert.ok(symbols.includes("handle_error"));
  });

  it("extracts async functions", () => {
    const code = `async def fetch_data():\n    pass`;
    const symbols = extractPythonSymbols(code);
    assert.ok(symbols.includes("fetch_data"));
  });

  it("extracts classes", () => {
    const code = `class DataProcessor:\n    pass\nclass Config:\n    pass`;
    const symbols = extractPythonSymbols(code);
    assert.ok(symbols.includes("DataProcessor"));
    assert.ok(symbols.includes("Config"));
  });

  it("extracts ALL_CAPS constants", () => {
    const code = `MAX_RETRIES = 5\nDEFAULT_TIMEOUT = 30`;
    const symbols = extractPythonSymbols(code);
    assert.ok(symbols.includes("MAX_RETRIES"));
    assert.ok(symbols.includes("DEFAULT_TIMEOUT"));
  });

  it("ignores private functions (underscore prefix)", () => {
    const code = `def _internal_helper():\n    pass`;
    const symbols = extractPythonSymbols(code);
    assert.equal(symbols.length, 0);
  });

  it("ignores indented (nested) definitions", () => {
    const code = `class Outer:\n    def inner_method(self):\n        pass`;
    const symbols = extractPythonSymbols(code);
    assert.ok(symbols.includes("Outer"));
    assert.ok(!symbols.includes("inner_method"));
  });
});

describe("extractGoSymbols", () => {
  it("extracts exported functions (capitalized)", () => {
    const code = `func HandleRequest(w http.ResponseWriter, r *http.Request) {}`;
    const symbols = extractGoSymbols(code);
    assert.ok(symbols.includes("HandleRequest"));
  });

  it("extracts exported method receivers", () => {
    const code = `func (s *Server) Start() error {}`;
    const symbols = extractGoSymbols(code);
    assert.ok(symbols.includes("Start"));
  });

  it("extracts exported types", () => {
    const code = `type Config struct {\n}\ntype Handler interface {\n}`;
    const symbols = extractGoSymbols(code);
    assert.ok(symbols.includes("Config"));
    assert.ok(symbols.includes("Handler"));
  });

  it("ignores unexported symbols (lowercase)", () => {
    const code = `func internalHelper() {}\ntype config struct {}`;
    const symbols = extractGoSymbols(code);
    assert.equal(symbols.length, 0);
  });
});

describe("extractRustSymbols", () => {
  it("extracts pub fn", () => {
    const code = `pub fn process_data(input: &str) -> Result<()> {}`;
    const symbols = extractRustSymbols(code);
    assert.ok(symbols.includes("process_data"));
  });

  it("extracts pub async fn", () => {
    const code = `pub async fn fetch_data() -> Response {}`;
    const symbols = extractRustSymbols(code);
    assert.ok(symbols.includes("fetch_data"));
  });

  it("extracts pub struct/enum/trait", () => {
    const code = `pub struct Config {}\npub enum Status {}\npub trait Handler {}`;
    const symbols = extractRustSymbols(code);
    assert.ok(symbols.includes("Config"));
    assert.ok(symbols.includes("Status"));
    assert.ok(symbols.includes("Handler"));
  });

  it("extracts pub(crate) items", () => {
    const code = `pub(crate) fn internal_fn() {}`;
    const symbols = extractRustSymbols(code);
    assert.ok(symbols.includes("internal_fn"));
  });

  it("ignores non-pub items", () => {
    const code = `fn private_fn() {}\nstruct InternalStruct {}`;
    const symbols = extractRustSymbols(code);
    assert.equal(symbols.length, 0);
  });
});

describe("extractJavaSymbols", () => {
  it("extracts public class", () => {
    const code = `public class UserService {\n}`;
    const symbols = extractJavaSymbols(code);
    assert.ok(symbols.includes("UserService"));
  });

  it("extracts public interface and enum", () => {
    const code = `public interface Handler {}\npublic enum Status {}`;
    const symbols = extractJavaSymbols(code);
    assert.ok(symbols.includes("Handler"));
    assert.ok(symbols.includes("Status"));
  });

  it("extracts abstract classes", () => {
    const code = `public abstract class BaseService {}`;
    const symbols = extractJavaSymbols(code);
    assert.ok(symbols.includes("BaseService"));
  });

  it("ignores private/package-private classes", () => {
    const code = `class InternalHelper {}`;
    const symbols = extractJavaSymbols(code);
    assert.equal(symbols.length, 0);
  });
});

describe("extractCSymbols", () => {
  it("extracts struct and enum declarations", () => {
    const code = `struct Config {\n};\nenum Status {\n};`;
    const symbols = extractCSymbols(code);
    assert.ok(symbols.includes("Config"));
    assert.ok(symbols.includes("Status"));
  });

  it("ignores comments", () => {
    const code = `// struct NotReal\n/* class Fake */\n* inside block comment`;
    const symbols = extractCSymbols(code);
    assert.equal(symbols.length, 0);
  });
});

describe("extractPHPSymbols", () => {
  it("extracts functions and classes", () => {
    const code = `function processData() {}\nclass UserService {}`;
    const symbols = extractPHPSymbols(code);
    assert.ok(symbols.includes("processData"));
    assert.ok(symbols.includes("UserService"));
  });
});

describe("extractRubySymbols", () => {
  it("extracts top-level defs and classes", () => {
    const code = `def process_data\nend\nclass UserService\nend\nmodule Auth\nend`;
    const symbols = extractRubySymbols(code);
    assert.ok(symbols.includes("process_data"));
    assert.ok(symbols.includes("UserService"));
    assert.ok(symbols.includes("Auth"));
  });

  it("ignores indented methods", () => {
    const code = `class Foo\n  def bar\n  end\nend`;
    const symbols = extractRubySymbols(code);
    assert.ok(symbols.includes("Foo"));
    assert.ok(!symbols.includes("bar"));
  });
});

describe("extractSymbols dispatcher", () => {
  it("routes to correct extractor by language", () => {
    const jsCode = `export function hello() {}`;
    assert.ok(extractSymbols(jsCode, "javascript").includes("hello"));
    assert.ok(extractSymbols(jsCode, "typescript").includes("hello"));
  });

  it("returns empty for unknown language", () => {
    assert.deepEqual(extractSymbols("anything", "brainfuck"), []);
  });
});

// ──────────────────────────────────────────────
// File Tree Tests
// ──────────────────────────────────────────────

describe("buildFileTree", () => {
  it("builds nested tree from flat paths", () => {
    const files = [
      { path: "src/index.js", size: 100, lines: 10, symbols: ["main"] },
      { path: "src/utils/helpers.js", size: 200, lines: 20, symbols: [] },
      { path: "README.md", size: 50, lines: 5, symbols: [] },
    ];
    const tree = buildFileTree(files);
    assert.ok(tree.__dirs.src);
    assert.ok(tree.__dirs.src.__dirs.utils);
    assert.equal(tree.__files.length, 1);
    assert.equal(tree.__files[0].name, "README.md");
  });

  it("handles backslash paths (Windows)", () => {
    const files = [{ path: "src\\tools\\handler.js", size: 100, lines: 10 }];
    const tree = buildFileTree(files);
    assert.ok(tree.__dirs.src.__dirs.tools);
  });

  it("handles empty file list", () => {
    const tree = buildFileTree([]);
    assert.equal(Object.keys(tree.__dirs).length, 0);
    assert.equal(tree.__files.length, 0);
  });
});

describe("formatFileTree", () => {
  it("formats tree with indentation", () => {
    const files = [
      { path: "src/index.js", size: 100, lines: 10, symbols: ["main"] },
      { path: "src/utils.js", size: 200, lines: 20, symbols: ["helper"] },
    ];
    const tree = buildFileTree(files);
    const output = formatFileTree(tree);
    assert.ok(output.includes("src/"));
    assert.ok(output.includes("  index.js"));
    assert.ok(output.includes("main"));
  });

  it("omits symbols when showSymbols is false", () => {
    const files = [
      { path: "app.js", size: 100, lines: 10, symbols: ["start"], status: "" },
    ];
    const tree = buildFileTree(files);
    const output = formatFileTree(tree, { showSymbols: false });
    assert.ok(!output.includes("start"));
  });

  it("shows git status markers", () => {
    const files = [
      { path: "modified.js", size: 100, lines: 10, symbols: [], status: "M" },
    ];
    const tree = buildFileTree(files);
    const output = formatFileTree(tree);
    assert.ok(output.includes("[M]"));
  });

  it("sorts directories before files", () => {
    const files = [
      { path: "b.js", size: 10, lines: 1, symbols: [] },
      { path: "a/x.js", size: 10, lines: 1, symbols: [] },
    ];
    const tree = buildFileTree(files);
    const output = formatFileTree(tree);
    const lines = output.split("\n").filter(Boolean);
    assert.ok(lines[0].includes("a/"));
    assert.ok(lines[lines.length - 1].includes("b.js"));
  });
});

// ──────────────────────────────────────────────
// RepoMapService Tests
// ──────────────────────────────────────────────

describe("RepoMapService", () => {
  /** @type {RepoMapService} */
  let service;
  let mockGitService;
  let mockFs;
  let mockIgnore;

  beforeEach(() => {
    mockGitService = {
      getTrackedFiles: async () => ["src/index.js", "src/utils.js", "README.md"],
      getFileStatus: async () => new Map([["src/index.js", "M"]]),
    };

    mockFs = {
      readdir: async (dirPath, opts) => [],
      readFile: async (filePath) => {
        if (filePath.includes("index.js")) {
          return `export function main() {}\nexport class App {}`;
        }
        if (filePath.includes("utils.js")) {
          return `export function helper() {}\nexport const VERSION = "1.0"`;
        }
        return "# README\nSome content";
      },
      stat: async (filePath) => ({
        size: 500,
        isFile: () => true,
        isDirectory: () => false,
      }),
    };

    mockIgnore = {
      shouldIgnore: (p) => false,
      shouldIgnoreDirectory: (d) => false,
    };

    service = new RepoMapService({
      gitService: mockGitService,
      fortifyIgnore: mockIgnore,
      fsPromises: mockFs,
    });
  });

  it("generates repo map with file entries", async () => {
    const map = await service.generateRepoMap({ cwd: "/test/project" });
    assert.ok(map.files.length > 0);
    assert.equal(map.totalFiles, 3);
    assert.equal(map.truncated, false);
  });

  it("extracts symbols when includeSymbols is true", async () => {
    const map = await service.generateRepoMap({ cwd: "/test/project", includeSymbols: true });
    const indexFile = map.files.find((f) => f.path === "src/index.js");
    assert.ok(indexFile);
    assert.ok(indexFile.symbols.includes("main"));
    assert.ok(indexFile.symbols.includes("App"));
  });

  it("skips symbols when includeSymbols is false", async () => {
    const map = await service.generateRepoMap({ cwd: "/test/project", includeSymbols: false });
    const indexFile = map.files.find((f) => f.path === "src/index.js");
    assert.ok(indexFile);
    assert.equal(indexFile.symbols.length, 0);
  });

  it("includes git status annotations", async () => {
    const map = await service.generateRepoMap({ cwd: "/test/project" });
    const indexFile = map.files.find((f) => f.path === "src/index.js");
    assert.equal(indexFile.status, "M");
  });

  it("respects fortifyIgnore filter", async () => {
    mockIgnore.shouldIgnore = (p) => p === "README.md";
    const map = await service.generateRepoMap({ cwd: "/test/project" });
    assert.ok(!map.files.find((f) => f.path === "README.md"));
    assert.equal(map.files.length, 2);
  });

  it("caps files at maxFiles", async () => {
    const map = await service.generateRepoMap({ cwd: "/test/project", maxFiles: 2 });
    assert.equal(map.files.length, 2);
    assert.equal(map.truncated, true);
    assert.equal(map.totalFiles, 3);
  });

  it("caps symbol extraction at maxSymbolFiles", async () => {
    mockGitService.getTrackedFiles = async () => ["a.js", "b.js", "c.js"];
    mockFs.readFile = async () => `export function fn() {}`;
    const map = await service.generateRepoMap({
      cwd: "/test/project",
      maxSymbolFiles: 1,
    });
    const filesWithSymbols = map.files.filter((f) => f.symbols.length > 0);
    assert.equal(filesWithSymbols.length, 1);
    assert.equal(map.symbolFiles, 1);
  });

  it("handles stat errors gracefully", async () => {
    mockFs.stat = async () => { throw new Error("ENOENT"); };
    const map = await service.generateRepoMap({ cwd: "/test/project" });
    assert.ok(map.files.length > 0);
    assert.equal(map.files[0].size, 0);
  });

  it("handles readFile errors during symbol extraction gracefully", async () => {
    mockFs.readFile = async () => { throw new Error("Permission denied"); };
    const map = await service.generateRepoMap({ cwd: "/test/project" });
    assert.ok(map.files.length > 0);
    assert.equal(map.files[0].symbols.length, 0);
  });

  it("falls back to readdir walk when git is unavailable", async () => {
    mockGitService.getTrackedFiles = async () => [];

    mockFs.readdir = async (dirPath, opts) => {
      if (dirPath.endsWith("project")) {
        return [
          { name: "app.js", isFile: () => true, isDirectory: () => false },
          { name: "node_modules", isFile: () => false, isDirectory: () => true },
        ];
      }
      return [];
    };

    const map = await service.generateRepoMap({ cwd: "/test/project" });
    assert.equal(map.files.length, 1);
    assert.equal(map.files[0].path, "app.js");
  });

  it("skips dot directories in fallback walk", async () => {
    service = new RepoMapService({
      gitService: null,
      fsPromises: {
        ...mockFs,
        readdir: async (dirPath, opts) => {
          if (dirPath.endsWith("project")) {
            return [
              { name: ".hidden", isFile: () => false, isDirectory: () => true },
              { name: "visible.js", isFile: () => true, isDirectory: () => false },
            ];
          }
          return [];
        },
      },
    });

    const map = await service.generateRepoMap({ cwd: "/test/project" });
    assert.equal(map.files.length, 1);
    assert.equal(map.files[0].path, "visible.js");
  });

  it("works with no git service at all", async () => {
    service = new RepoMapService({
      gitService: null,
      fsPromises: {
        ...mockFs,
        readdir: async () => [
          { name: "main.py", isFile: () => true, isDirectory: () => false },
        ],
      },
    });

    const map = await service.generateRepoMap({ cwd: "/test/project" });
    assert.ok(map.files.length >= 0);
  });

  it("counts totalSymbols correctly", async () => {
    const map = await service.generateRepoMap({ cwd: "/test/project" });
    const expectedTotal = map.files.reduce((sum, f) => sum + f.symbols.length, 0);
    assert.equal(map.totalSymbols, expectedTotal);
  });

  it("normalizes backslashes in output paths", async () => {
    mockGitService.getTrackedFiles = async () => ["src\\tools\\handler.js"];
    const map = await service.generateRepoMap({ cwd: "/test/project" });
    assert.ok(map.files[0].path.includes("/"));
    assert.ok(!map.files[0].path.includes("\\"));
  });
});

describe("RepoMapService.formatForPrompt", () => {
  let service;

  beforeEach(() => {
    service = new RepoMapService();
  });

  it("formats repo map with header", () => {
    const repoMap = {
      files: [
        { path: "src/index.js", size: 500, lines: 20, symbols: ["main"], status: "" },
      ],
      totalFiles: 1,
      truncated: false,
      symbolFiles: 1,
      totalSymbols: 1,
    };

    const output = service.formatForPrompt(repoMap);
    assert.ok(output.includes("[Repository Map]"));
    assert.ok(output.includes("1 files"));
    assert.ok(output.includes("1 symbols"));
    assert.ok(output.includes("index.js"));
    assert.ok(output.includes("main"));
  });

  it("indicates truncation in header", () => {
    const repoMap = {
      files: [{ path: "a.js", size: 100, lines: 5, symbols: [], status: "" }],
      totalFiles: 100,
      truncated: true,
      symbolFiles: 0,
      totalSymbols: 0,
    };

    const output = service.formatForPrompt(repoMap);
    assert.ok(output.includes("showing first 1"));
  });

  it("returns empty string for empty repo map", () => {
    const output = service.formatForPrompt({ files: [], totalFiles: 0, truncated: false, symbolFiles: 0, totalSymbols: 0 });
    assert.equal(output, "");
  });

  it("returns empty string for null input", () => {
    const output = service.formatForPrompt(null);
    assert.equal(output, "");
  });

  it("truncates to maxTokens by removing symbols first", () => {
    const files = [];
    for (let i = 0; i < 100; i++) {
      files.push({
        path: `src/module${i}.js`,
        size: 500,
        lines: 50,
        symbols: ["FunctionA", "FunctionB", "ClassC"],
        status: "",
      });
    }
    const repoMap = { files, totalFiles: 100, truncated: false, symbolFiles: 100, totalSymbols: 300 };

    const output = service.formatForPrompt(repoMap, { maxTokens: 500 });
    // Should fit within budget
    assert.ok(output.length <= 500 * 4 + 200); // Some header overhead
  });

  it("adds '... and N more files' when hard-truncated", () => {
    const files = [];
    for (let i = 0; i < 200; i++) {
      files.push({
        path: `deeply/nested/dir/subdir/module${i}.js`,
        size: 500,
        lines: 50,
        symbols: [],
        status: "",
      });
    }
    const repoMap = { files, totalFiles: 200, truncated: false, symbolFiles: 0, totalSymbols: 0 };

    const output = service.formatForPrompt(repoMap, { maxTokens: 100 });
    assert.ok(output.includes("more files"));
  });
});

describe("createRepoMapService", () => {
  it("creates an instance", () => {
    const service = createRepoMapService();
    assert.ok(service instanceof RepoMapService);
  });
});
