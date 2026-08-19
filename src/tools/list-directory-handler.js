import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Default maximum depth for directory listing.
 */
const DEFAULT_MAX_DEPTH = 3;

/**
 * Tree-drawing characters.
 */
const TREE_CHARS = {
  branch: "├── ",
  lastBranch: "└── ",
  indent: "│   ",
  lastIndent: "    ",
};

/**
 * Format file size into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

/**
 * list_directory tool handler.
 *
 * Lists files and directories at a given path in a tree format
 * with file sizes and entry counts. Used by the agentic loop
 * to let the LLM explore the workspace structure.
 *
 * @param {object} params - Tool parameters from the LLM
 * @param {string} params.path - Relative directory path to list (default: ".")
 * @param {number} [params.depth] - Maximum depth (default: 3)
 * @param {object} context - Execution context
 * @param {string} context.cwd - Project root directory
 * @param {import("../config/fortifyignore.js").FortifyIgnore} [context.fortifyIgnore] - Ignore patterns
 * @param {object} [context.fsPromises] - Filesystem module (for testing)
 * @returns {Promise<{ output: string }>}
 */
export async function listDirectoryHandler(params, context) {
  const { path: dirPath = ".", depth: maxDepth } = params || {};
  const {
    cwd = process.cwd(),
    fortifyIgnore,
    fsPromises = { readdir, stat },
  } = context;

  // 1. Resolve path
  const targetPath = path.resolve(cwd, (dirPath || ".").trim());
  const normalizedCwd = path.resolve(cwd);

  if (!targetPath.startsWith(normalizedCwd)) {
    return {
      output: `[Error] Path '${dirPath}' resolves outside the project root.`,
    };
  }

  // 2. Check if path exists and is a directory
  let targetStats;
  try {
    targetStats = await fsPromises.stat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { output: `[Error] Directory not found: '${dirPath}'` };
    }
    throw error;
  }

  if (!targetStats.isDirectory()) {
    return { output: `[Error] '${dirPath}' is not a directory.` };
  }

  // 3. Build tree
  const effectiveDepth = typeof maxDepth === "number" && maxDepth > 0
    ? maxDepth
    : DEFAULT_MAX_DEPTH;

  const relativePath = path.relative(cwd, targetPath).replace(/\\/g, "/") || ".";
  const lines = [`${relativePath}/`];
  const stats = { files: 0, dirs: 0 };

  await buildTree(targetPath, normalizedCwd, fortifyIgnore, fsPromises, lines, "", effectiveDepth, 0, stats);

  // 4. Build summary
  lines.push("");
  lines.push(`${stats.dirs} director${stats.dirs !== 1 ? "ies" : "y"}, ${stats.files} file${stats.files !== 1 ? "s" : ""}`);

  return { output: lines.join("\n") };
}

/**
 * Recursively build tree lines.
 *
 * @param {string} dirPath - Current directory
 * @param {string} rootCwd - Project root
 * @param {object|null} fortifyIgnore - Ignore patterns
 * @param {object} fs - Filesystem module
 * @param {string[]} lines - Output accumulator
 * @param {string} prefix - Current indentation prefix
 * @param {number} maxDepth - Maximum depth
 * @param {number} currentDepth - Current depth
 * @param {object} stats - File/dir counters
 */
async function buildTree(dirPath, rootCwd, fortifyIgnore, fs, lines, prefix, maxDepth, currentDepth, stats) {
  if (currentDepth >= maxDepth) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  // Filter ignored entries
  const filtered = [];
  for (const entry of entries) {
    const relativePath = path.relative(rootCwd, path.join(dirPath, entry.name)).replace(/\\/g, "/");

    if (fortifyIgnore) {
      if (entry.isDirectory() && fortifyIgnore.shouldIgnoreDirectory(entry.name)) {
        continue;
      }
      if (fortifyIgnore.shouldIgnore(relativePath)) {
        continue;
      }
    }

    filtered.push(entry);
  }

  // Sort: directories first, then alphabetically
  filtered.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i];
    const isLast = i === filtered.length - 1;
    const connector = isLast ? TREE_CHARS.lastBranch : TREE_CHARS.branch;
    const childPrefix = isLast ? TREE_CHARS.lastIndent : TREE_CHARS.indent;

    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      stats.dirs++;

      // Count children for summary
      let childCount = 0;
      try {
        const children = await fs.readdir(absolutePath);
        childCount = children.length;
      } catch {
        // Skip unreadable
      }

      const countLabel = childCount > 0 ? `  (${childCount} entries)` : "  (empty)";
      lines.push(`${prefix}${connector}${entry.name}/${countLabel}`);

      await buildTree(absolutePath, rootCwd, fortifyIgnore, fs, lines, prefix + childPrefix, maxDepth, currentDepth + 1, stats);
    } else if (entry.isFile()) {
      stats.files++;

      let sizeLabel = "";
      try {
        const fileStats = await fs.stat(absolutePath);
        sizeLabel = `  (${formatSize(fileStats.size)})`;
      } catch {
        // Skip stat errors
      }

      lines.push(`${prefix}${connector}${entry.name}${sizeLabel}`);
    }
  }
}

// Export for testing
export { DEFAULT_MAX_DEPTH, formatSize };
