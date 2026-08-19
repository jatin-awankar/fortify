import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Built-in ignore patterns — always active even without a .fortifyignore file.
 * Aligned with the existing IGNORED_DIRECTORY_NAMES in src/utils/project-files.js.
 */
const BUILTIN_PATTERNS = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".cache/",
  ".coverage/",
  "coverage/",
  ".fortify/",
  ".env",
  ".env.*",
  "*.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "*.tgz",
  "*.log",
  ".DS_Store",
  "Thumbs.db",
];

/**
 * Convert a gitignore-style glob pattern to a RegExp.
 *
 * Supports:
 *  - `*`   → any characters except `/`
 *  - `**`  → any characters including `/` (recursive match)
 *  - `?`   → any single character except `/`
 *  - `/`   → path separator (normalized)
 *  - Trailing `/` → directory match (matches the dir and anything inside)
 *  - Leading `/` → anchored to root
 *  - `!`   → negation (handled externally, not in this function)
 *
 * @param {string} pattern - Gitignore-style glob pattern
 * @returns {{ regex: RegExp, negated: boolean }}
 */
function compilePattern(pattern) {
  let negated = false;
  let p = pattern;

  // Handle negation
  if (p.startsWith("!")) {
    negated = true;
    p = p.slice(1);
  }

  // Remove leading slash (anchors pattern to root)
  const anchored = p.startsWith("/");
  if (anchored) {
    p = p.slice(1);
  }

  // Trailing slash means "match directory and everything inside"
  const isDirectoryPattern = p.endsWith("/");
  if (isDirectoryPattern) {
    p = p.slice(0, -1);
  }

  // Escape regex special chars (except our glob chars: * ? [ ])
  let regexStr = "";
  let i = 0;
  while (i < p.length) {
    const ch = p[i];

    if (ch === "*" && p[i + 1] === "*") {
      // ** — match everything including path separators
      if (p[i + 2] === "/") {
        // **/  — match zero or more directories
        regexStr += "(?:.+/)?";
        i += 3;
      } else {
        // ** at end — match everything
        regexStr += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      // * — match anything except /
      regexStr += "[^/]*";
      i++;
    } else if (ch === "?") {
      // ? — match any single char except /
      regexStr += "[^/]";
      i++;
    } else if (ch === ".") {
      regexStr += "\\.";
      i++;
    } else if (ch === "+" || ch === "^" || ch === "$" || ch === "{" || ch === "}" || ch === "|" || ch === "(" || ch === ")") {
      regexStr += "\\" + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }

  // Build the final regex
  let finalRegex;
  if (isDirectoryPattern) {
    // Match the directory itself OR anything inside it
    if (anchored) {
      finalRegex = `^${regexStr}(?:/|$)`;
    } else {
      finalRegex = `(?:^|/)${regexStr}(?:/|$)`;
    }
  } else if (anchored) {
    finalRegex = `^${regexStr}$`;
  } else {
    // Unanchored: match anywhere in the path
    // A pattern like "*.log" should match "foo.log" and "src/foo.log"
    finalRegex = `(?:^|/)${regexStr}$`;
  }

  return {
    regex: new RegExp(finalRegex),
    negated,
  };
}

/**
 * Parse a gitignore/fortifyignore file content into pattern strings.
 *
 * @param {string} content - Raw file content
 * @returns {string[]} Array of non-empty, non-comment patterns
 */
function parseIgnoreFileContent(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * FortifyIgnore — file and directory exclusion engine.
 *
 * Reads patterns from `.fortifyignore`, `.gitignore`, and built-in defaults.
 * Used by tool handlers (read_file, search_files, list_directory) and
 * the summarizer to skip irrelevant files.
 *
 * Pattern priority (last match wins, like gitignore):
 *  1. Built-in defaults (always applied)
 *  2. .gitignore patterns (merged if present)
 *  3. .fortifyignore patterns (highest priority, overrides .gitignore)
 *  4. Negation patterns (! prefix) re-include files
 */
export class FortifyIgnore {
  #compiledRules = [];
  #rawPatterns = [];
  #loaded = false;

  /**
   * @param {object} options
   * @param {string} [options.cwd] - Project root directory
   * @param {string[]} [options.patterns] - Additional patterns to include
   * @param {object} [options.fsPromises] - Filesystem module (for testing)
   */
  constructor({
    cwd = process.cwd(),
    patterns = [],
    fsPromises = { readFile },
  } = {}) {
    this.cwd = cwd;
    this.fs = fsPromises;
    this._extraPatterns = patterns;
  }

  /**
   * Load patterns from built-in defaults, .gitignore, and .fortifyignore.
   * Safe to call multiple times — only loads once.
   *
   * @returns {Promise<void>}
   */
  async load() {
    if (this.#loaded) return;

    // 1. Built-in defaults
    this.#addPatterns(BUILTIN_PATTERNS, "builtin");

    // 2. .gitignore (additive, lower priority)
    const gitignoreContent = await this.#readFileQuietly(
      path.join(this.cwd, ".gitignore"),
    );
    if (gitignoreContent) {
      const gitPatterns = parseIgnoreFileContent(gitignoreContent);
      this.#addPatterns(gitPatterns, ".gitignore");
    }

    // 3. .fortifyignore (highest priority)
    const fortifyignoreContent = await this.#readFileQuietly(
      path.join(this.cwd, ".fortifyignore"),
    );
    if (fortifyignoreContent) {
      const fortifyPatterns = parseIgnoreFileContent(fortifyignoreContent);
      this.#addPatterns(fortifyPatterns, ".fortifyignore");
    }

    // 4. Extra patterns passed via constructor
    if (this._extraPatterns.length > 0) {
      this.#addPatterns(this._extraPatterns, "custom");
    }

    this.#loaded = true;
  }

  /**
   * Check if a file or directory path should be ignored.
   *
   * @param {string} relativePath - Path relative to the project root (forward slashes)
   * @returns {boolean} true if the path should be ignored
   */
  shouldIgnore(relativePath) {
    if (!relativePath) return false;

    // Normalize to forward slashes and remove leading ./
    const normalized = relativePath
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");

    if (!normalized) return false;

    // Apply rules in order — last match wins (gitignore semantics)
    let ignored = false;

    for (const rule of this.#compiledRules) {
      if (rule.regex.test(normalized) || rule.regex.test("/" + normalized)) {
        ignored = !rule.negated;
      }
    }

    return ignored;
  }

  /**
   * Check if a directory name (single segment) should be ignored.
   * Faster check for directory traversal — skips checking the full path.
   *
   * @param {string} dirName - Directory base name (e.g., "node_modules")
   * @returns {boolean}
   */
  shouldIgnoreDirectory(dirName) {
    return this.shouldIgnore(dirName + "/");
  }

  /**
   * Get all active raw patterns.
   * @returns {string[]}
   */
  getPatterns() {
    return [...this.#rawPatterns];
  }

  /**
   * Check if patterns have been loaded.
   * @returns {boolean}
   */
  get isLoaded() {
    return this.#loaded;
  }

  /**
   * Add patterns and compile them into regex rules.
   * @param {string[]} patterns
   * @param {string} _source - Source label for debugging
   */
  #addPatterns(patterns, _source) {
    for (const pattern of patterns) {
      if (!pattern || typeof pattern !== "string") continue;

      const trimmed = pattern.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      this.#rawPatterns.push(trimmed);

      try {
        const compiled = compilePattern(trimmed);
        this.#compiledRules.push(compiled);
      } catch {
        // Skip invalid patterns silently
      }
    }
  }

  /**
   * Read a file and return its content, or null if it doesn't exist.
   * @param {string} filePath
   * @returns {Promise<string|null>}
   */
  async #readFileQuietly(filePath) {
    try {
      return await this.fs.readFile(filePath, "utf8");
    } catch {
      return null;
    }
  }
}

/**
 * Create and load a FortifyIgnore instance.
 * Convenience factory function.
 *
 * @param {object} [options]
 * @returns {Promise<FortifyIgnore>}
 */
export async function createFortifyIgnore(options) {
  const ignore = new FortifyIgnore(options);
  await ignore.load();
  return ignore;
}

// Re-export for direct use
export { BUILTIN_PATTERNS, compilePattern, parseIgnoreFileContent };
