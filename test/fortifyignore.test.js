import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  FortifyIgnore,
  createFortifyIgnore,
  BUILTIN_PATTERNS,
  compilePattern,
  parseIgnoreFileContent,
} from "../src/config/fortifyignore.js";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Create a mock fs module that returns predefined file contents. */
function createMockFs(files = {}) {
  return {
    readFile: async (filePath) => {
      const normalized = filePath.replace(/\\/g, "/");
      for (const [key, content] of Object.entries(files)) {
        const normalizedKey = key.replace(/\\/g, "/");
        if (normalized.endsWith(normalizedKey) || normalized === normalizedKey) {
          return content;
        }
      }
      const err = new Error(`ENOENT: no such file: ${filePath}`);
      err.code = "ENOENT";
      throw err;
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// parseIgnoreFileContent
// ─────────────────────────────────────────────────────────────────

describe("parseIgnoreFileContent", () => {
  it("parses non-empty, non-comment lines", () => {
    const content = `
# This is a comment
node_modules/
dist/

# Another comment
*.log
    `;
    const result = parseIgnoreFileContent(content);
    assert.deepStrictEqual(result, ["node_modules/", "dist/", "*.log"]);
  });

  it("handles Windows line endings", () => {
    const content = "node_modules/\r\ndist/\r\n*.log\r\n";
    const result = parseIgnoreFileContent(content);
    assert.deepStrictEqual(result, ["node_modules/", "dist/", "*.log"]);
  });

  it("returns empty array for empty content", () => {
    assert.deepStrictEqual(parseIgnoreFileContent(""), []);
    assert.deepStrictEqual(parseIgnoreFileContent("  \n  \n  "), []);
  });

  it("returns empty array for comments-only content", () => {
    const content = "# comment 1\n# comment 2\n";
    assert.deepStrictEqual(parseIgnoreFileContent(content), []);
  });
});

// ─────────────────────────────────────────────────────────────────
// compilePattern
// ─────────────────────────────────────────────────────────────────

describe("compilePattern", () => {
  it("compiles a simple file pattern", () => {
    const { regex, negated } = compilePattern("*.log");
    assert.equal(negated, false);
    assert.ok(regex.test("debug.log"));
    assert.ok(regex.test("/src/debug.log"));
    assert.ok(!regex.test("debug.txt"));
  });

  it("compiles a directory pattern (trailing slash)", () => {
    const { regex } = compilePattern("node_modules/");
    assert.ok(regex.test("node_modules/"));
    assert.ok(regex.test("node_modules/foo.js"));
    assert.ok(regex.test("/node_modules/"));
    assert.ok(!regex.test("my_node_modules"));
  });

  it("compiles a negation pattern", () => {
    const { regex, negated } = compilePattern("!important.log");
    assert.equal(negated, true);
    assert.ok(regex.test("important.log"));
  });

  it("compiles a double-star pattern", () => {
    const { regex } = compilePattern("**/dist/");
    assert.ok(regex.test("dist/"));
    assert.ok(regex.test("packages/app/dist/"));
    assert.ok(regex.test("/packages/app/dist/foo.js"));
  });

  it("compiles an anchored pattern (leading /)", () => {
    const { regex } = compilePattern("/build");
    assert.ok(regex.test("build"));
    assert.ok(!regex.test("src/build"));
  });

  it("compiles wildcard with extension", () => {
    const { regex } = compilePattern("*.tgz");
    assert.ok(regex.test("package.tgz"));
    assert.ok(regex.test("/releases/package.tgz"));
    assert.ok(!regex.test("package.tar.gz"));
  });

  it("compiles dotfile patterns", () => {
    const { regex } = compilePattern(".env");
    assert.ok(regex.test(".env"));
    assert.ok(regex.test("/.env"));
    assert.ok(!regex.test(".env.local")); // Exact match only
  });

  it("compiles dotfile wildcard patterns", () => {
    const { regex } = compilePattern(".env.*");
    assert.ok(regex.test(".env.local"));
    assert.ok(regex.test(".env.production"));
    assert.ok(!regex.test(".env"));
  });

  it("compiles question mark wildcard", () => {
    const { regex } = compilePattern("file?.txt");
    assert.ok(regex.test("file1.txt"));
    assert.ok(regex.test("fileA.txt"));
    assert.ok(!regex.test("file.txt"));
    assert.ok(!regex.test("file12.txt"));
  });
});

// ─────────────────────────────────────────────────────────────────
// FortifyIgnore — constructor & load
// ─────────────────────────────────────────────────────────────────

describe("FortifyIgnore", () => {
  describe("load", () => {
    it("loads built-in patterns when no files exist", async () => {
      const ignore = new FortifyIgnore({
        cwd: "/fake/project",
        fsPromises: createMockFs({}),
      });
      await ignore.load();

      assert.ok(ignore.isLoaded);
      assert.ok(ignore.getPatterns().length > 0);
      // Should have all builtin patterns
      for (const p of BUILTIN_PATTERNS) {
        assert.ok(
          ignore.getPatterns().includes(p),
          `Missing builtin pattern: ${p}`,
        );
      }
    });

    it("merges .gitignore patterns", async () => {
      const ignore = new FortifyIgnore({
        cwd: "/fake/project",
        fsPromises: createMockFs({
          ".gitignore": "vendor/\n*.pyc\n",
        }),
      });
      await ignore.load();

      assert.ok(ignore.getPatterns().includes("vendor/"));
      assert.ok(ignore.getPatterns().includes("*.pyc"));
    });

    it("merges .fortifyignore patterns", async () => {
      const ignore = new FortifyIgnore({
        cwd: "/fake/project",
        fsPromises: createMockFs({
          ".fortifyignore": "secrets/\n*.bak\n",
        }),
      });
      await ignore.load();

      assert.ok(ignore.getPatterns().includes("secrets/"));
      assert.ok(ignore.getPatterns().includes("*.bak"));
    });

    it("merges custom extra patterns", async () => {
      const ignore = new FortifyIgnore({
        cwd: "/fake/project",
        patterns: ["custom_dir/", "*.custom"],
        fsPromises: createMockFs({}),
      });
      await ignore.load();

      assert.ok(ignore.getPatterns().includes("custom_dir/"));
      assert.ok(ignore.getPatterns().includes("*.custom"));
    });

    it("only loads once (idempotent)", async () => {
      let callCount = 0;
      const ignore = new FortifyIgnore({
        cwd: "/fake/project",
        fsPromises: {
          readFile: async () => {
            callCount++;
            const err = new Error("ENOENT");
            err.code = "ENOENT";
            throw err;
          },
        },
      });

      await ignore.load();
      const firstCallCount = callCount;
      await ignore.load();
      assert.equal(callCount, firstCallCount, "Should not re-read files");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // shouldIgnore
  // ─────────────────────────────────────────────────────────────────

  describe("shouldIgnore", () => {
    let ignore;

    beforeEach(async () => {
      ignore = new FortifyIgnore({
        cwd: "/project",
        fsPromises: createMockFs({}),
      });
      await ignore.load();
    });

    it("ignores node_modules", () => {
      assert.ok(ignore.shouldIgnore("node_modules/"));
      assert.ok(ignore.shouldIgnore("node_modules/foo.js"));
    });

    it("ignores .git directory", () => {
      assert.ok(ignore.shouldIgnore(".git/"));
      assert.ok(ignore.shouldIgnore(".git/HEAD"));
    });

    it("ignores dist directory", () => {
      assert.ok(ignore.shouldIgnore("dist/"));
      assert.ok(ignore.shouldIgnore("dist/bundle.js"));
    });

    it("ignores build artifacts", () => {
      assert.ok(ignore.shouldIgnore("build/"));
      assert.ok(ignore.shouldIgnore("out/"));
      assert.ok(ignore.shouldIgnore(".next/"));
      assert.ok(ignore.shouldIgnore(".cache/"));
      assert.ok(ignore.shouldIgnore("coverage/"));
    });

    it("ignores lock files", () => {
      assert.ok(ignore.shouldIgnore("package-lock.json"));
      assert.ok(ignore.shouldIgnore("pnpm-lock.yaml"));
      assert.ok(ignore.shouldIgnore("yarn.lock"));
    });

    it("ignores .env files", () => {
      assert.ok(ignore.shouldIgnore(".env"));
      assert.ok(ignore.shouldIgnore(".env.local"));
      assert.ok(ignore.shouldIgnore(".env.production"));
    });

    it("ignores log files", () => {
      assert.ok(ignore.shouldIgnore("debug.log"));
      assert.ok(ignore.shouldIgnore("src/app.log"));
    });

    it("ignores OS files", () => {
      assert.ok(ignore.shouldIgnore(".DS_Store"));
      assert.ok(ignore.shouldIgnore("Thumbs.db"));
    });

    it("does NOT ignore regular source files", () => {
      assert.ok(!ignore.shouldIgnore("src/index.js"));
      assert.ok(!ignore.shouldIgnore("src/services/chat-service.js"));
      assert.ok(!ignore.shouldIgnore("package.json"));
      assert.ok(!ignore.shouldIgnore("README.md"));
      assert.ok(!ignore.shouldIgnore("test/unit.test.js"));
    });

    it("normalizes backslashes to forward slashes", () => {
      assert.ok(ignore.shouldIgnore("node_modules\\foo.js"));
      assert.ok(!ignore.shouldIgnore("src\\index.js"));
    });

    it("handles leading ./ prefix", () => {
      assert.ok(ignore.shouldIgnore("./node_modules/foo.js"));
      assert.ok(!ignore.shouldIgnore("./src/index.js"));
    });

    it("returns false for empty or null paths", () => {
      assert.ok(!ignore.shouldIgnore(""));
      assert.ok(!ignore.shouldIgnore(null));
      assert.ok(!ignore.shouldIgnore(undefined));
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // shouldIgnoreDirectory
  // ─────────────────────────────────────────────────────────────────

  describe("shouldIgnoreDirectory", () => {
    it("ignores built-in directory names", async () => {
      const ignore = new FortifyIgnore({
        cwd: "/project",
        fsPromises: createMockFs({}),
      });
      await ignore.load();

      assert.ok(ignore.shouldIgnoreDirectory("node_modules"));
      assert.ok(ignore.shouldIgnoreDirectory(".git"));
      assert.ok(ignore.shouldIgnoreDirectory("dist"));
      assert.ok(ignore.shouldIgnoreDirectory("build"));
      assert.ok(ignore.shouldIgnoreDirectory(".next"));
      assert.ok(ignore.shouldIgnoreDirectory(".cache"));
      assert.ok(ignore.shouldIgnoreDirectory("coverage"));
    });

    it("does NOT ignore regular directories", async () => {
      const ignore = new FortifyIgnore({
        cwd: "/project",
        fsPromises: createMockFs({}),
      });
      await ignore.load();

      assert.ok(!ignore.shouldIgnoreDirectory("src"));
      assert.ok(!ignore.shouldIgnoreDirectory("test"));
      assert.ok(!ignore.shouldIgnoreDirectory("lib"));
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Negation patterns
  // ─────────────────────────────────────────────────────────────────

  describe("negation patterns", () => {
    it("negation re-includes a previously ignored pattern", async () => {
      const ignore = new FortifyIgnore({
        cwd: "/project",
        fsPromises: createMockFs({
          ".fortifyignore": "*.log\n!important.log\n",
        }),
      });
      await ignore.load();

      assert.ok(ignore.shouldIgnore("debug.log"));
      assert.ok(!ignore.shouldIgnore("important.log"));
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // .gitignore + .fortifyignore interaction
  // ─────────────────────────────────────────────────────────────────

  describe("gitignore + fortifyignore interaction", () => {
    it("fortifyignore patterns override gitignore patterns", async () => {
      const ignore = new FortifyIgnore({
        cwd: "/project",
        fsPromises: createMockFs({
          ".gitignore": "*.log\nvendor/\n",
          ".fortifyignore": "!vendor/\nsecrets/\n",
        }),
      });
      await ignore.load();

      // .gitignore says ignore vendor/, .fortifyignore says !vendor/
      // Since .fortifyignore patterns are added after, !vendor/ wins
      assert.ok(!ignore.shouldIgnore("vendor/package.json"));

      // secrets/ only in .fortifyignore
      assert.ok(ignore.shouldIgnore("secrets/"));
      assert.ok(ignore.shouldIgnore("secrets/api-key.txt"));

      // *.log from .gitignore still active
      assert.ok(ignore.shouldIgnore("debug.log"));
    });
  });
});

// ─────────────────────────────────────────────────────────────────
// createFortifyIgnore factory
// ─────────────────────────────────────────────────────────────────

describe("createFortifyIgnore", () => {
  it("creates and loads a FortifyIgnore instance", async () => {
    const ignore = await createFortifyIgnore({
      cwd: "/fake/project",
      fsPromises: createMockFs({}),
    });

    assert.ok(ignore instanceof FortifyIgnore);
    assert.ok(ignore.isLoaded);
    assert.ok(ignore.shouldIgnore("node_modules/foo.js"));
    assert.ok(!ignore.shouldIgnore("src/index.js"));
  });
});
