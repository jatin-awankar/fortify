/**
 * Repo-Map Service — generates a structured map of the project's file tree
 * with optional top-level symbol extraction for system prompt injection.
 *
 * This is the intelligence layer that lets the LLM "see" the project structure
 * without needing to call list_directory or read_file for orientation.
 *
 * Features:
 * - Uses `git ls-files` for tracked file discovery (fast, respects .gitignore)
 * - Falls back to recursive readdir walk when not in a git repo
 * - Respects .fortifyignore patterns
 * - Extracts top-level symbols (functions, classes, exports) via regex
 * - Token-budget-aware formatting with intelligent truncation
 * - Git status annotations ([M]odified, [A]dded, [?]untracked)
 *
 * Zero external dependencies — pure Node.js built-in modules.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Maximum number of files to process for the repo map.
 * Beyond this, files are listed without symbols to save tokens.
 */
const DEFAULT_MAX_FILES = 500;

/**
 * Maximum number of files to extract symbols from.
 * Symbol extraction involves reading file contents — capped for performance.
 */
const DEFAULT_MAX_SYMBOL_FILES = 150;

/**
 * Maximum file size (bytes) for symbol extraction.
 * Skip large files to avoid slow regex processing.
 */
const MAX_SYMBOL_FILE_SIZE = 100_000;

/**
 * Maximum lines of content to scan for symbols.
 */
const MAX_SYMBOL_SCAN_LINES = 500;

/**
 * File extensions that support symbol extraction.
 */
const SYMBOL_EXTRACTORS = new Map([
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".jsx", "javascript"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".py", "python"],
  [".go", "go"],
  [".rs", "rust"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".c", "c"],
  [".h", "c"],
  [".cpp", "cpp"],
  [".hpp", "cpp"],
  [".php", "php"],
  [".rb", "ruby"],
]);

/**
 * Directories to always skip during readdir walk (fallback mode).
 */
const WALK_SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  ".cache", ".coverage", "coverage", "__pycache__", ".tox",
  ".venv", "venv", ".mypy_cache", "target", ".gradle",
  ".idea", ".vscode", ".fortify",
]);

// ──────────────────────────────────────────────
// Symbol Extraction — Regex-based, per-language
// ──────────────────────────────────────────────

/**
 * Extract top-level exported symbols from JavaScript/TypeScript source.
 *
 * Detects:
 * - `export function name(` / `export async function name(`
 * - `export class name`
 * - `export const/let/var name`
 * - `export default function name` / `export default class name`
 * - `module.exports = { ... }` keys
 *
 * @param {string} content - File content
 * @returns {string[]} Extracted symbol names
 */
export function extractJSSymbols(content) {
  const symbols = [];
  const seen = new Set();
  const lines = content.split("\n").slice(0, MAX_SYMBOL_SCAN_LINES);

  for (const line of lines) {
    const trimmed = line.trim();

    // export function/class/const
    let match = trimmed.match(
      /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?\s+|class\s+|const\s+|let\s+|var\s+)([a-zA-Z_$][a-zA-Z0-9_$]*)/
    );
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
      continue;
    }

    // module.exports = { key1, key2 }
    match = trimmed.match(/^module\.exports\s*=\s*\{([^}]+)\}/);
    if (match) {
      const keys = match[1].split(",").map((k) => k.trim().split(":")[0].trim()).filter(Boolean);
      for (const key of keys) {
        if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) && !seen.has(key)) {
          seen.add(key);
          symbols.push(key);
        }
      }
    }
  }

  return symbols;
}

/**
 * Extract top-level symbols from Python source.
 *
 * Detects top-level (no indentation):
 * - `def function_name(`
 * - `class ClassName`
 * - `CONSTANT = `  (ALL_CAPS variables)
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractPythonSymbols(content) {
  const symbols = [];
  const seen = new Set();
  const lines = content.split("\n").slice(0, MAX_SYMBOL_SCAN_LINES);

  for (const line of lines) {
    // Top-level only — no leading whitespace
    if (line.startsWith(" ") || line.startsWith("\t")) continue;

    let match = line.match(/^(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (match && !match[1].startsWith("_") && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
      continue;
    }

    match = line.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
      continue;
    }

    // Top-level constants (ALL_CAPS)
    match = line.match(/^([A-Z][A-Z0-9_]{2,})\s*=/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
    }
  }

  return symbols;
}

/**
 * Extract exported symbols from Go source.
 *
 * Detects capitalized (exported) declarations:
 * - `func FunctionName(`
 * - `func (r *Receiver) MethodName(`
 * - `type TypeName struct/interface`
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractGoSymbols(content) {
  const symbols = [];
  const seen = new Set();
  const lines = content.split("\n").slice(0, MAX_SYMBOL_SCAN_LINES);

  for (const line of lines) {
    const trimmed = line.trim();

    // func FunctionName(  or  func (r *Type) MethodName(
    let match = trimmed.match(/^func\s+(?:\([^)]*\)\s+)?([A-Z][a-zA-Z0-9_]*)\s*\(/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
      continue;
    }

    // type TypeName struct/interface
    match = trimmed.match(/^type\s+([A-Z][a-zA-Z0-9_]*)\s+(?:struct|interface)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
    }
  }

  return symbols;
}

/**
 * Extract public symbols from Rust source.
 *
 * Detects:
 * - `pub fn function_name(`
 * - `pub async fn function_name(`
 * - `pub struct StructName`
 * - `pub enum EnumName`
 * - `pub trait TraitName`
 * - `pub type TypeName`
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractRustSymbols(content) {
  const symbols = [];
  const seen = new Set();
  const lines = content.split("\n").slice(0, MAX_SYMBOL_SCAN_LINES);

  for (const line of lines) {
    const trimmed = line.trim();

    let match = trimmed.match(
      /^pub(?:\s*\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const|static)\s+([a-zA-Z_][a-zA-Z0-9_]*)/
    );
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
    }
  }

  return symbols;
}

/**
 * Extract public symbols from Java/Kotlin source.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractJavaSymbols(content) {
  const symbols = [];
  const seen = new Set();
  const lines = content.split("\n").slice(0, MAX_SYMBOL_SCAN_LINES);

  for (const line of lines) {
    const trimmed = line.trim();

    const match = trimmed.match(
      /^(?:public|protected)\s+(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum|record)\s+([a-zA-Z_][a-zA-Z0-9_]*)/
    );
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
    }
  }

  return symbols;
}

/**
 * Extract top-level symbols from C/C++ header/source files.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractCSymbols(content) {
  const symbols = [];
  const seen = new Set();
  const lines = content.split("\n").slice(0, MAX_SYMBOL_SCAN_LINES);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

    // class/struct/enum declarations
    let match = trimmed.match(/^(?:class|struct|enum)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
      continue;
    }

    // Function declarations (simplified: type name( at top level)
    match = trimmed.match(/^(?:[\w:*&<>]+\s+)+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (match && !seen.has(match[1]) && !["if", "while", "for", "switch", "return", "sizeof"].includes(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
    }
  }

  return symbols;
}

/**
 * Extract symbols from PHP source.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractPHPSymbols(content) {
  const symbols = [];
  const seen = new Set();
  const lines = content.split("\n").slice(0, MAX_SYMBOL_SCAN_LINES);

  for (const line of lines) {
    const trimmed = line.trim();

    let match = trimmed.match(/^(?:public|protected|private)?\s*(?:static\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
      continue;
    }

    match = trimmed.match(/^(?:abstract\s+)?class\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
    }
  }

  return symbols;
}

/**
 * Extract symbols from Ruby source.
 *
 * @param {string} content
 * @returns {string[]}
 */
export function extractRubySymbols(content) {
  const symbols = [];
  const seen = new Set();
  const lines = content.split("\n").slice(0, MAX_SYMBOL_SCAN_LINES);

  for (const line of lines) {
    if (line.startsWith(" ") || line.startsWith("\t")) continue;

    let match = line.match(/^(?:def\s+)([a-zA-Z_][a-zA-Z0-9_!?]*)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
      continue;
    }

    match = line.match(/^(?:class|module)\s+([A-Z][a-zA-Z0-9_]*)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      symbols.push(match[1]);
    }
  }

  return symbols;
}

/**
 * Extract symbols from file content based on language.
 *
 * @param {string} content - File content
 * @param {string} language - Language identifier from SYMBOL_EXTRACTORS
 * @returns {string[]}
 */
export function extractSymbols(content, language) {
  switch (language) {
    case "javascript":
    case "typescript":
      return extractJSSymbols(content);
    case "python":
      return extractPythonSymbols(content);
    case "go":
      return extractGoSymbols(content);
    case "rust":
      return extractRustSymbols(content);
    case "java":
    case "kotlin":
      return extractJavaSymbols(content);
    case "c":
    case "cpp":
      return extractCSymbols(content);
    case "php":
      return extractPHPSymbols(content);
    case "ruby":
      return extractRubySymbols(content);
    default:
      return [];
  }
}

// ──────────────────────────────────────────────
// File Tree Building
// ──────────────────────────────────────────────

/**
 * Build a nested directory tree structure from a flat list of relative paths.
 *
 * @param {Array<{ path: string, size?: number, lines?: number, symbols?: string[], status?: string }>} files
 * @returns {object} Nested tree object
 */
export function buildFileTree(files) {
  const root = { __files: [], __dirs: {} };

  for (const file of files) {
    const parts = file.path.replace(/\\/g, "/").split("/");
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      if (!current.__dirs[dirName]) {
        current.__dirs[dirName] = { __files: [], __dirs: {} };
      }
      current = current.__dirs[dirName];
    }

    current.__files.push({
      name: parts[parts.length - 1],
      size: file.size,
      lines: file.lines,
      symbols: file.symbols || [],
      status: file.status || "",
    });
  }

  return root;
}

/**
 * Format a file tree into a compact, indented text representation.
 *
 * @param {object} tree - Nested tree from buildFileTree
 * @param {object} [options]
 * @param {number} [options.indent] - Current indentation level
 * @param {boolean} [options.showSymbols] - Whether to show symbols
 * @param {boolean} [options.showLines] - Whether to show line counts
 * @returns {string}
 */
export function formatFileTree(tree, { indent = 0, showSymbols = true, showLines = true } = {}) {
  const lines = [];
  const prefix = "  ".repeat(indent);

  // Sort directories first, then files
  const dirNames = Object.keys(tree.__dirs).sort();
  const fileEntries = [...tree.__files].sort((a, b) => a.name.localeCompare(b.name));

  for (const dirName of dirNames) {
    lines.push(`${prefix}${dirName}/`);
    const subtree = formatFileTree(tree.__dirs[dirName], {
      indent: indent + 1,
      showSymbols,
      showLines,
    });
    if (subtree) lines.push(subtree);
  }

  for (const file of fileEntries) {
    let entry = `${prefix}${file.name}`;
    const meta = [];

    if (file.status) {
      meta.push(`[${file.status}]`);
    }
    if (showLines && file.lines > 0) {
      meta.push(`${file.lines}L`);
    }
    if (showSymbols && file.symbols.length > 0) {
      meta.push(`— ${file.symbols.join(", ")}`);
    }

    if (meta.length > 0) {
      entry += ` (${meta.filter((m) => !m.startsWith("—")).join(", ")})`;
      const symbolMeta = meta.find((m) => m.startsWith("—"));
      if (symbolMeta) {
        entry = entry.replace(")", ` ${symbolMeta})`);
      }
    }

    lines.push(entry);
  }

  return lines.join("\n");
}

// ──────────────────────────────────────────────
// Repo-Map Service
// ──────────────────────────────────────────────

/**
 * RepoMapService — generates a structured map of the project for LLM context.
 *
 * Usage:
 * ```js
 * const service = new RepoMapService({ gitService, fortifyIgnore });
 * const map = await service.generateRepoMap({ cwd: "/path/to/project" });
 * const prompt = service.formatForPrompt(map, { maxTokens: 3000 });
 * ```
 */
export class RepoMapService {
  /**
   * @param {object} options
   * @param {import("./git-service.js").GitService} [options.gitService]
   * @param {import("../config/fortifyignore.js").FortifyIgnore} [options.fortifyIgnore]
   * @param {object} [options.fsPromises] - Filesystem module for testing
   */
  constructor({
    gitService,
    fortifyIgnore,
    fsPromises = { readdir, readFile, stat },
  } = {}) {
    this.gitService = gitService || null;
    this.fortifyIgnore = fortifyIgnore || null;
    this.fs = fsPromises;
  }

  /**
   * Generate a full repository map.
   *
   * @param {object} options
   * @param {string} options.cwd - Project root directory
   * @param {boolean} [options.includeSymbols=true] - Extract top-level symbols
   * @param {number} [options.maxFiles=500] - Maximum files to include
   * @param {number} [options.maxSymbolFiles=150] - Maximum files for symbol extraction
   * @returns {Promise<RepoMap>}
   *
   * @typedef {{ files: RepoMapFile[], totalFiles: number, truncated: boolean, symbolFiles: number, totalSymbols: number }} RepoMap
   * @typedef {{ path: string, size: number, lines: number, symbols: string[], status: string }} RepoMapFile
   */
  async generateRepoMap({
    cwd,
    includeSymbols = true,
    maxFiles = DEFAULT_MAX_FILES,
    maxSymbolFiles = DEFAULT_MAX_SYMBOL_FILES,
  } = {}) {
    const workingDir = cwd || process.cwd();

    // 1. Discover files
    let filePaths = await this.#discoverFiles(workingDir);

    // 2. Filter with fortifyIgnore
    if (this.fortifyIgnore) {
      filePaths = filePaths.filter((fp) => !this.fortifyIgnore.shouldIgnore(fp));
    }

    // 3. Get git status annotations
    let statusMap = new Map();
    if (this.gitService) {
      try {
        statusMap = await this.gitService.getFileStatus({ cwd: workingDir });
      } catch {
        // Non-critical — continue without status
      }
    }

    // 4. Cap total files
    const truncated = filePaths.length > maxFiles;
    const cappedPaths = filePaths.slice(0, maxFiles);

    // 5. Build file entries with optional symbol extraction
    const files = [];
    let symbolFilesProcessed = 0;
    let totalSymbols = 0;

    for (const relativePath of cappedPaths) {
      const absolutePath = path.resolve(workingDir, relativePath);
      const ext = path.extname(relativePath).toLowerCase();
      const language = SYMBOL_EXTRACTORS.get(ext);
      const status = statusMap.get(relativePath) || "";

      let fileSize = 0;
      let lineCount = 0;
      let symbols = [];

      try {
        const fileStat = await this.fs.stat(absolutePath);
        fileSize = fileStat.size;

        // Extract symbols if applicable
        if (
          includeSymbols &&
          language &&
          symbolFilesProcessed < maxSymbolFiles &&
          fileSize > 0 &&
          fileSize <= MAX_SYMBOL_FILE_SIZE
        ) {
          try {
            const content = await this.fs.readFile(absolutePath, "utf8");
            lineCount = content.split("\n").length;
            symbols = extractSymbols(content, language);
            symbolFilesProcessed++;
            totalSymbols += symbols.length;
          } catch {
            // Read failed — still include file without symbols
          }
        } else if (fileSize > 0 && fileSize <= MAX_SYMBOL_FILE_SIZE && language) {
          // At least count lines for small source files
          try {
            const content = await this.fs.readFile(absolutePath, "utf8");
            lineCount = content.split("\n").length;
          } catch {
            // Ignore read errors
          }
        }
      } catch {
        // Stat failed — include with zero size
      }

      files.push({
        path: relativePath.replace(/\\/g, "/"),
        size: fileSize,
        lines: lineCount,
        symbols,
        status,
      });
    }

    return {
      files,
      totalFiles: filePaths.length,
      truncated,
      symbolFiles: symbolFilesProcessed,
      totalSymbols,
    };
  }

  /**
   * Format a repo map for injection into the system prompt.
   *
   * @param {RepoMap} repoMap
   * @param {object} [options]
   * @param {number} [options.maxTokens=3000] - Token budget for the output
   * @param {boolean} [options.showSymbols=true]
   * @param {boolean} [options.showLines=true]
   * @returns {string}
   */
  formatForPrompt(repoMap, { maxTokens = 3000, showSymbols = true, showLines = true } = {}) {
    if (!repoMap || !repoMap.files || repoMap.files.length === 0) {
      return "";
    }

    const tree = buildFileTree(repoMap.files);
    let formatted = formatFileTree(tree, { showSymbols, showLines });

    // Estimate tokens (~4 chars per token)
    const estimatedTokens = Math.ceil(formatted.length / 4);

    if (estimatedTokens > maxTokens) {
      // Truncate: first try without symbols
      const noSymbolFormatted = formatFileTree(tree, { showSymbols: false, showLines });
      const noSymbolTokens = Math.ceil(noSymbolFormatted.length / 4);

      if (noSymbolTokens <= maxTokens) {
        formatted = noSymbolFormatted;
      } else {
        // Still too large: truncate lines
        const maxChars = maxTokens * 4;
        const lines = noSymbolFormatted.split("\n");
        let charCount = 0;
        let lastLine = 0;

        for (let i = 0; i < lines.length; i++) {
          charCount += lines[i].length + 1;
          if (charCount > maxChars) break;
          lastLine = i;
        }

        const remaining = lines.length - lastLine - 1;
        formatted = lines.slice(0, lastLine + 1).join("\n");
        if (remaining > 0) {
          formatted += `\n  ... and ${remaining} more files`;
        }
      }
    }

    let header = `[Repository Map] (${repoMap.totalFiles} files`;
    if (repoMap.totalSymbols > 0) {
      header += `, ${repoMap.totalSymbols} symbols`;
    }
    if (repoMap.truncated) {
      header += `, showing first ${repoMap.files.length}`;
    }
    header += ")";

    return `${header}\n${formatted}`;
  }

  /**
   * Discover project files — uses git ls-files when possible,
   * falls back to recursive directory walk.
   *
   * @param {string} cwd - Project root
   * @returns {Promise<string[]>} Sorted array of relative file paths
   */
  async #discoverFiles(cwd) {
    // Try git ls-files first (fast, respects .gitignore)
    if (this.gitService) {
      try {
        const trackedFiles = await this.gitService.getTrackedFiles({ cwd });
        if (trackedFiles.length > 0) {
          // Also include untracked files from git status
          let untrackedFiles = [];
          try {
            const statusMap = await this.gitService.getFileStatus({ cwd });
            for (const [filePath, status] of statusMap) {
              if (status === "?" && !trackedFiles.includes(filePath)) {
                untrackedFiles.push(filePath);
              }
            }
          } catch {
            // Non-critical
          }

          const allFiles = [...trackedFiles, ...untrackedFiles];
          allFiles.sort((a, b) => a.localeCompare(b));
          return allFiles;
        }
      } catch {
        // Fall through to readdir walk
      }
    }

    // Fallback: recursive directory walk
    return this.#walkDirectory(cwd, cwd);
  }

  /**
   * Recursive directory walker (fallback when git is unavailable).
   *
   * @param {string} dirPath - Current directory to scan
   * @param {string} rootPath - Project root (for relative path calculation)
   * @param {string[]} [collected] - Accumulated file paths
   * @returns {Promise<string[]>}
   */
  async #walkDirectory(dirPath, rootPath, collected = []) {
    let entries;
    try {
      entries = await this.fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return collected;
    }

    for (const entry of entries) {
      if (collected.length >= DEFAULT_MAX_FILES) break;

      const absolutePath = path.join(dirPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (WALK_SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }

        // Check fortifyIgnore for directories
        if (this.fortifyIgnore && this.fortifyIgnore.shouldIgnoreDirectory(entry.name)) {
          continue;
        }

        await this.#walkDirectory(absolutePath, rootPath, collected);
      } else if (entry.isFile()) {
        collected.push(relativePath);
      }
    }

    collected.sort((a, b) => a.localeCompare(b));
    return collected;
  }
}

/**
 * Create a RepoMapService instance.
 * @param {object} [options]
 * @returns {RepoMapService}
 */
export function createRepoMapService(options) {
  return new RepoMapService(options);
}
