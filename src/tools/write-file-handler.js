import { writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Maximum file content size the handler will accept (1MB).
 * Prevents the LLM from generating excessively large files.
 */
const MAX_WRITE_BYTES = 1_048_576;

/**
 * Validate and resolve the file path for writing.
 * Ensures the path doesn't escape the project root.
 *
 * @param {string} relativePath - Relative path from params
 * @param {string} cwd - Project root
 * @returns {{ absolutePath: string, normalizedRelative: string }}
 * @throws {Error} if path is invalid or escapes project root
 */
function resolveAndValidateWritePath(relativePath, cwd) {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("File path is required.");
  }

  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error("File path cannot be empty.");
  }

  // Reject obviously dangerous paths
  if (trimmed.includes("\0")) {
    throw new Error("File path contains null bytes. Rejected.");
  }

  const absolutePath = path.resolve(cwd, trimmed);

  // Security: ensure the resolved path is within the project root
  const normalizedCwd = path.resolve(cwd);
  if (!absolutePath.startsWith(normalizedCwd + path.sep) && absolutePath !== normalizedCwd) {
    throw new Error(
      `Path '${trimmed}' resolves outside the project root. Access denied.`,
    );
  }

  const normalizedRelative = path.relative(cwd, absolutePath).replace(/\\/g, "/");

  return { absolutePath, normalizedRelative };
}

/**
 * Check if a file already exists at the given path.
 *
 * @param {string} absolutePath
 * @param {object} fs - Filesystem module
 * @returns {Promise<{ exists: boolean, isFile: boolean, isDirectory: boolean, size: number }>}
 */
async function checkExistingFile(absolutePath, fs) {
  try {
    const fileStats = await fs.stat(absolutePath);
    return {
      exists: true,
      isFile: fileStats.isFile(),
      isDirectory: fileStats.isDirectory(),
      size: fileStats.size,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, isFile: false, isDirectory: false, size: 0 };
    }
    throw error;
  }
}

/**
 * write_file tool handler.
 *
 * Creates or overwrites a file in the workspace. Automatically creates
 * parent directories if they don't exist. Used by the agentic loop
 * when the LLM needs to create new files or replace existing ones.
 *
 * For modifying existing files, prefer the `edit_file` tool instead —
 * it makes targeted search-and-replace edits which are safer.
 *
 * @param {object} params - Tool parameters from the LLM
 * @param {string} params.path - Relative file path to write
 * @param {string} params.content - Full file content to write
 * @param {object} context - Execution context
 * @param {string} context.cwd - Project root directory
 * @param {object} [context.fsPromises] - Filesystem module (for testing)
 * @returns {Promise<{ output: string }>}
 */
export async function writeFileHandler(params, context) {
  const { path: filePath, content } = params;
  const {
    cwd = process.cwd(),
    fsPromises = { writeFile, mkdir, stat },
  } = context;

  // 1. Validate path
  const { absolutePath, normalizedRelative } = resolveAndValidateWritePath(
    filePath,
    cwd,
  );

  // 2. Validate content
  if (content === undefined || content === null) {
    return {
      output: `[Error] File content is required. Cannot write empty content to '${normalizedRelative}'.`,
    };
  }

  const contentStr = typeof content === "string" ? content : String(content);

  // 3. Check content size
  const contentBytes = Buffer.byteLength(contentStr, "utf8");
  if (contentBytes > MAX_WRITE_BYTES) {
    const sizeMB = (contentBytes / (1024 * 1024)).toFixed(1);
    return {
      output: `[Error] Content too large (${sizeMB}MB). Maximum write size is ${MAX_WRITE_BYTES / (1024 * 1024)}MB.`,
    };
  }

  // 4. Check if file already exists
  const existing = await checkExistingFile(absolutePath, fsPromises);

  if (existing.exists && existing.isDirectory) {
    return {
      output: `[Error] '${normalizedRelative}' is a directory. Cannot overwrite a directory with a file.`,
    };
  }

  // 5. Create parent directories
  const parentDir = path.dirname(absolutePath);
  try {
    await fsPromises.mkdir(parentDir, { recursive: true });
  } catch (error) {
    return {
      output: `[Error] Failed to create directory '${path.relative(cwd, parentDir)}': ${error.message}`,
    };
  }

  // 6. Write the file
  try {
    await fsPromises.writeFile(absolutePath, contentStr, "utf8");
  } catch (error) {
    return {
      output: `[Error] Failed to write file '${normalizedRelative}': ${error.message}`,
    };
  }

  // 7. Build success output
  const lineCount = contentStr.split("\n").length;
  const sizeLabel =
    contentBytes >= 1024
      ? `${(contentBytes / 1024).toFixed(1)}KB`
      : `${contentBytes}B`;

  const action = existing.exists && existing.isFile ? "Updated" : "Created";
  let output = `${action} ${normalizedRelative} (${lineCount} lines, ${sizeLabel})`;

  if (existing.exists && existing.isFile) {
    const oldSizeLabel =
      existing.size >= 1024
        ? `${(existing.size / 1024).toFixed(1)}KB`
        : `${existing.size}B`;
    output += ` [previously ${oldSizeLabel}]`;
  }

  return { output };
}

// Export helpers for testing
export { resolveAndValidateWritePath, checkExistingFile, MAX_WRITE_BYTES };
