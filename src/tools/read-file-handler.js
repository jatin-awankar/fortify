import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Maximum file size that will be returned to the LLM (100KB).
 * Larger files are truncated with a warning.
 */
const MAX_OUTPUT_BYTES = 102_400;

/**
 * Maximum number of bytes to probe for binary detection.
 */
const BINARY_PROBE_SIZE = 8_192;

/**
 * Map of file extensions to language identifiers for metadata.
 */
const EXTENSION_LANGUAGE_MAP = {
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".php": "php",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".svg": "svg",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".txt": "text",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "zsh",
  ".ps1": "powershell",
  ".bat": "batch",
  ".dockerfile": "dockerfile",
  ".env": "dotenv",
  ".ini": "ini",
  ".cfg": "ini",
};

/**
 * Detect language from file path.
 * @param {string} filePath
 * @returns {string}
 */
function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (EXTENSION_LANGUAGE_MAP[ext]) {
    return EXTENSION_LANGUAGE_MAP[ext];
  }

  const baseName = path.basename(filePath).toLowerCase();
  if (baseName === "dockerfile") return "dockerfile";
  if (baseName === "makefile") return "makefile";
  if (baseName === ".gitignore" || baseName === ".npmignore") return "gitignore";

  return "text";
}

/**
 * Check if a buffer contains null bytes (binary file indicator).
 * @param {Buffer} buffer
 * @param {number} length - Number of bytes to check
 * @returns {boolean}
 */
function containsNullByte(buffer, length) {
  const checkLength = Math.min(length, BINARY_PROBE_SIZE);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Validate and resolve the file path.
 * Ensures the path doesn't escape the project root.
 *
 * @param {string} relativePath - Relative path from params
 * @param {string} cwd - Project root
 * @returns {{ absolutePath: string, normalizedRelative: string }}
 * @throws {Error} if path is invalid or escapes project root
 */
function resolveAndValidatePath(relativePath, cwd) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("File path is required.");
  }

  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error("File path cannot be empty.");
  }

  const absolutePath = path.resolve(cwd, trimmed);

  // Security: ensure the resolved path is within the project root
  const normalizedCwd = path.resolve(cwd);
  if (!absolutePath.startsWith(normalizedCwd)) {
    throw new Error(
      `Path '${trimmed}' resolves outside the project root. Access denied.`,
    );
  }

  const normalizedRelative = path.relative(cwd, absolutePath).replace(/\\/g, "/");

  return { absolutePath, normalizedRelative };
}

/**
 * Format file contents with line numbers.
 * @param {string} content
 * @returns {string}
 */
function addLineNumbers(content) {
  const lines = content.split("\n");
  const padWidth = String(lines.length).length;

  return lines
    .map((line, index) => {
      const lineNum = String(index + 1).padStart(padWidth, " ");
      return `${lineNum}: ${line}`;
    })
    .join("\n");
}

/**
 * read_file tool handler.
 *
 * Reads the contents of a file from the workspace and returns it
 * with line numbers prepended. Used by the agentic loop to give
 * the LLM visibility into file contents.
 *
 * @param {object} params - Tool parameters from the LLM
 * @param {string} params.path - Relative file path to read
 * @param {object} context - Execution context
 * @param {string} context.cwd - Project root directory
 * @param {import("../config/fortifyignore.js").FortifyIgnore} [context.fortifyIgnore] - Ignore patterns
 * @param {object} [context.fsPromises] - Filesystem module (for testing)
 * @returns {Promise<{ output: string }>}
 */
export async function readFileHandler(params, context) {
  const { path: filePath } = params;
  const {
    cwd = process.cwd(),
    fortifyIgnore,
    fsPromises = { readFile, stat },
  } = context;

  // 1. Validate and resolve path
  const { absolutePath, normalizedRelative } = resolveAndValidatePath(filePath, cwd);

  // 2. Check ignore patterns
  if (fortifyIgnore && fortifyIgnore.shouldIgnore(normalizedRelative)) {
    return {
      output: `[Ignored] File '${normalizedRelative}' matches ignore patterns (.fortifyignore/.gitignore). Skipped.`,
    };
  }

  // 3. Check file exists and get stats
  let fileStats;
  try {
    fileStats = await fsPromises.stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        output: `[Error] File not found: '${normalizedRelative}'`,
      };
    }
    throw error;
  }

  if (fileStats.isDirectory()) {
    return {
      output: `[Error] '${normalizedRelative}' is a directory, not a file. Use list_directory instead.`,
    };
  }

  if (!fileStats.isFile()) {
    return {
      output: `[Error] '${normalizedRelative}' is not a regular file.`,
    };
  }

  // 4. Read file content
  const rawBuffer = await fsPromises.readFile(absolutePath);

  // 5. Binary detection
  if (containsNullByte(rawBuffer, rawBuffer.length)) {
    const sizeKB = (fileStats.size / 1024).toFixed(1);
    return {
      output: `[Binary file] '${normalizedRelative}' (${sizeKB}KB) — cannot display binary content.`,
    };
  }

  // 6. Decode to string
  let content = rawBuffer.toString("utf8");
  let truncated = false;

  // 7. Truncate if too large
  if (rawBuffer.length > MAX_OUTPUT_BYTES) {
    content = rawBuffer.toString("utf8", 0, MAX_OUTPUT_BYTES);
    truncated = true;
  }

  // 8. Normalize line endings
  content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 9. Add line numbers
  const numberedContent = addLineNumbers(content);

  // 10. Build metadata
  const lineCount = content.split("\n").length;
  const language = detectLanguage(normalizedRelative);
  const sizeLabel =
    fileStats.size >= 1024
      ? `${(fileStats.size / 1024).toFixed(1)}KB`
      : `${fileStats.size}B`;

  // 11. Build output
  let output = `File: ${normalizedRelative} (${sizeLabel}, ${lineCount} lines, ${language})\n`;
  output += `${"─".repeat(60)}\n`;
  output += numberedContent;

  if (truncated) {
    output += `\n\n[Truncated] File exceeds ${Math.round(MAX_OUTPUT_BYTES / 1024)}KB limit. Showing first ${Math.round(MAX_OUTPUT_BYTES / 1024)}KB.`;
  }

  return { output };
}

// Export helpers for testing
export {
  resolveAndValidatePath,
  addLineNumbers,
  detectLanguage,
  containsNullByte,
  MAX_OUTPUT_BYTES,
};
