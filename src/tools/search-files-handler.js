import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Maximum number of matching results to return.
 */
const MAX_RESULTS = 50;

/**
 * Maximum number of files to scan.
 */
const MAX_FILES_SCANNED = 500;

/**
 * Maximum file size to scan (skip files larger than 1MB).
 */
const MAX_FILE_SIZE = 1_048_576;

/**
 * Binary file probe size.
 */
const BINARY_PROBE_SIZE = 512;

/**
 * Check if a buffer starts with null bytes (binary indicator).
 * @param {Buffer} buf
 * @returns {boolean}
 */
function looksLikeBinary(buf) {
  const checkLen = Math.min(buf.length, BINARY_PROBE_SIZE);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * search_files tool handler.
 *
 * Searches file contents across the workspace for a text pattern
 * or regular expression. Returns matching lines with file paths
 * and line numbers.
 *
 * @param {object} params - Tool parameters from the LLM
 * @param {string} params.query - Search text or regex pattern
 * @param {string} [params.path] - Subdirectory to scope the search (default: project root)
 * @param {boolean} [params.regex] - If true, treat query as a regex pattern
 * @param {object} context - Execution context
 * @param {string} context.cwd - Project root directory
 * @param {import("../config/fortifyignore.js").FortifyIgnore} [context.fortifyIgnore] - Ignore patterns
 * @param {object} [context.fsPromises] - Filesystem module (for testing)
 * @returns {Promise<{ output: string }>}
 */
export async function searchFilesHandler(params, context) {
  const { query, path: searchPath, regex: isRegex } = params;
  const {
    cwd = process.cwd(),
    fortifyIgnore,
    fsPromises = { readFile, readdir },
  } = context;

  // 1. Validate query
  if (!query || typeof query !== "string" || !query.trim()) {
    return { output: "[Error] Search query is required." };
  }

  const trimmedQuery = query.trim();

  // 2. Build matcher
  let matcher;
  if (isRegex) {
    try {
      // Don't use 'g' flag — .test() with global regex has stateful lastIndex
      const re = new RegExp(trimmedQuery);
      matcher = (line) => re.test(line);
    } catch (error) {
      return { output: `[Error] Invalid regex pattern: ${error.message}` };
    }
  } else {
    const lowerQuery = trimmedQuery.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(lowerQuery);
  }

  // 3. Resolve search root
  const searchRoot = searchPath
    ? path.resolve(cwd, searchPath.trim())
    : cwd;

  const normalizedCwd = path.resolve(cwd);
  if (!searchRoot.startsWith(normalizedCwd)) {
    return {
      output: `[Error] Search path '${searchPath}' resolves outside the project root.`,
    };
  }

  // 4. Collect files
  const results = [];
  let filesScanned = 0;

  await walkAndSearch(searchRoot, normalizedCwd, fortifyIgnore, matcher, results, {
    filesScanned: () => filesScanned,
    incrementScanned: () => { filesScanned++; },
    fsPromises,
  });

  // 5. Build output
  if (results.length === 0) {
    return {
      output: `No matches found for "${trimmedQuery}" (scanned ${filesScanned} files).`,
    };
  }

  let output = "";
  for (const result of results) {
    output += `${result.file}:${result.line}: ${result.content}\n`;
  }

  const truncatedNote = results.length >= MAX_RESULTS
    ? `\n[Truncated] Showing first ${MAX_RESULTS} matches.`
    : "";

  output += `\nFound ${results.length} match${results.length !== 1 ? "es" : ""} in ${new Set(results.map((r) => r.file)).size} file${new Set(results.map((r) => r.file)).size !== 1 ? "s" : ""} (scanned ${filesScanned} files)${truncatedNote}`;

  return { output };
}

/**
 * Recursively walk directories and search file contents.
 *
 * @param {string} dirPath - Current directory to scan
 * @param {string} rootCwd - Project root (for relative path calculation)
 * @param {object|null} fortifyIgnore - Ignore patterns
 * @param {Function} matcher - Line matching function
 * @param {Array} results - Accumulator for results
 * @param {object} state - Shared state counters
 */
async function walkAndSearch(dirPath, rootCwd, fortifyIgnore, matcher, results, state) {
  if (results.length >= MAX_RESULTS || state.filesScanned() >= MAX_FILES_SCANNED) {
    return;
  }

  let entries;
  try {
    entries = await state.fsPromises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS || state.filesScanned() >= MAX_FILES_SCANNED) {
      return;
    }

    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootCwd, absolutePath).replace(/\\/g, "/");

    // Check ignore patterns
    if (fortifyIgnore) {
      if (entry.isDirectory() && fortifyIgnore.shouldIgnoreDirectory(entry.name)) {
        continue;
      }
      if (fortifyIgnore.shouldIgnore(relativePath)) {
        continue;
      }
    }

    if (entry.isDirectory()) {
      await walkAndSearch(absolutePath, rootCwd, fortifyIgnore, matcher, results, state);
      continue;
    }

    if (!entry.isFile()) continue;

    state.incrementScanned();

    // Read file and search
    try {
      const buffer = await state.fsPromises.readFile(absolutePath);

      // Skip large files
      if (buffer.length > MAX_FILE_SIZE) continue;

      // Skip binary files
      if (looksLikeBinary(buffer)) continue;

      const content = buffer.toString("utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (results.length >= MAX_RESULTS) break;

        if (matcher(lines[i])) {
          results.push({
            file: relativePath,
            line: i + 1,
            content: lines[i].trim().slice(0, 200),
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
}

// Export for testing
export { MAX_RESULTS, MAX_FILES_SCANNED, MAX_FILE_SIZE };
