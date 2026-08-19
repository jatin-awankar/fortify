import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * edit_file tool handler.
 *
 * Makes targeted search-and-replace edits to existing files.
 * This is the preferred tool for modifying code — it's safer than
 * write_file because it only changes the targeted section.
 *
 * The handler:
 *  1. Reads the file
 *  2. Finds the exact `search` string
 *  3. Replaces it with the `replace` string
 *  4. Generates a unified diff of the change
 *  5. Writes the modified file
 *
 * If the search string is not found or matches multiple locations,
 * it returns a helpful error with context.
 *
 * @param {object} params - Tool parameters from the LLM
 * @param {string} params.path - Relative file path to edit
 * @param {string} params.search - Exact string to find
 * @param {string} params.replace - Replacement string
 * @param {object} context - Execution context
 * @param {string} context.cwd - Project root directory
 * @param {object} [context.fsPromises] - Filesystem module (for testing)
 * @returns {Promise<{ output: string }>}
 */
export async function editFileHandler(params, context) {
  const { path: filePath, search, replace } = params;
  const {
    cwd = process.cwd(),
    fsPromises = { readFile, writeFile },
  } = context;

  // 1. Validate params
  if (!filePath || typeof filePath !== "string" || !filePath.trim()) {
    return { output: "[Error] File path is required." };
  }

  if (search === undefined || search === null || typeof search !== "string") {
    return { output: "[Error] Search string is required." };
  }

  if (replace === undefined || replace === null || typeof replace !== "string") {
    return { output: "[Error] Replace string is required." };
  }

  if (search === replace) {
    return { output: "[Error] Search and replace strings are identical. No change needed." };
  }

  // 2. Resolve and validate path
  const trimmedPath = filePath.trim();
  const absolutePath = path.resolve(cwd, trimmedPath);
  const normalizedCwd = path.resolve(cwd);

  if (!absolutePath.startsWith(normalizedCwd + path.sep) && absolutePath !== normalizedCwd) {
    return {
      output: `[Error] Path '${trimmedPath}' resolves outside the project root. Access denied.`,
    };
  }

  const normalizedRelative = path.relative(cwd, absolutePath).replace(/\\/g, "/");

  // 3. Read file
  let originalContent;
  try {
    originalContent = await fsPromises.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { output: `[Error] File not found: '${normalizedRelative}'` };
    }
    return { output: `[Error] Failed to read '${normalizedRelative}': ${error.message}` };
  }

  // 4. Normalize line endings for matching
  const normalizedContent = originalContent.replace(/\r\n/g, "\n");
  const normalizedSearch = search.replace(/\r\n/g, "\n");
  const normalizedReplace = replace.replace(/\r\n/g, "\n");

  // 5. Find occurrences
  const occurrences = findAllOccurrences(normalizedContent, normalizedSearch);

  if (occurrences.length === 0) {
    const suggestion = findClosestMatch(normalizedContent, normalizedSearch);
    let errorMsg = `[Error] Search string not found in '${normalizedRelative}'.`;
    errorMsg += `\n\nSearch string (${normalizedSearch.length} chars):\n`;
    errorMsg += formatPreview(normalizedSearch, 5);

    if (suggestion) {
      errorMsg += `\n\nDid you mean (line ${suggestion.line}):\n`;
      errorMsg += formatPreview(suggestion.text, 5);
    }

    return { output: errorMsg };
  }

  if (occurrences.length > 1) {
    let errorMsg = `[Error] Search string matches ${occurrences.length} locations in '${normalizedRelative}'. `;
    errorMsg += `Please provide more context to uniquely identify the edit.\n`;

    for (let i = 0; i < Math.min(occurrences.length, 3); i++) {
      const occ = occurrences[i];
      errorMsg += `\nMatch ${i + 1} at line ${occ.line}:\n`;
      errorMsg += showContextLines(normalizedContent, occ.index, 2);
    }

    if (occurrences.length > 3) {
      errorMsg += `\n... and ${occurrences.length - 3} more matches.`;
    }

    return { output: errorMsg };
  }

  // 6. Perform the replacement
  const occurrence = occurrences[0];
  const modifiedContent =
    normalizedContent.slice(0, occurrence.index) +
    normalizedReplace +
    normalizedContent.slice(occurrence.index + normalizedSearch.length);

  // 7. Generate unified diff
  const diff = generateUnifiedDiff(
    normalizedRelative,
    normalizedContent,
    modifiedContent,
  );

  // 8. Write the file
  try {
    await fsPromises.writeFile(absolutePath, modifiedContent, "utf8");
  } catch (error) {
    return { output: `[Error] Failed to write '${normalizedRelative}': ${error.message}` };
  }

  // 9. Build success output
  const linesChanged = countChangedLines(normalizedSearch, normalizedReplace);
  let output = `Edited ${normalizedRelative} (${linesChanged})\n`;
  output += diff;

  return { output };
}

/**
 * Find all occurrences of a search string in content.
 *
 * @param {string} content
 * @param {string} search
 * @returns {Array<{ index: number, line: number }>}
 */
function findAllOccurrences(content, search) {
  const results = [];
  let startPos = 0;

  while (true) {
    const index = content.indexOf(search, startPos);
    if (index === -1) break;

    const line = content.slice(0, index).split("\n").length;
    results.push({ index, line });
    startPos = index + 1;
  }

  return results;
}

/**
 * Find the closest matching substring to help with "not found" errors.
 * Uses a prefix-matching heuristic on the first line of the search string.
 *
 * @param {string} content - Full file content
 * @param {string} search - Search string that wasn't found
 * @returns {{ text: string, line: number } | null}
 */
function findClosestMatch(content, search) {
  const searchFirstLine = search.split("\n")[0].trim();
  if (!searchFirstLine || searchFirstLine.length < 5) return null;

  const lines = content.split("\n");

  // Try full first line first, then progressively shorter prefixes
  const prefixLengths = [
    searchFirstLine.length,
    Math.floor(searchFirstLine.length * 0.6),
    Math.floor(searchFirstLine.length * 0.4),
  ].filter((len) => len >= 5);

  for (const prefixLen of prefixLengths) {
    const prefix = searchFirstLine.slice(0, prefixLen);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(prefix)) {
        const start = Math.max(0, i);
        const end = Math.min(lines.length, i + Math.min(search.split("\n").length + 1, 6));
        return {
          text: lines.slice(start, end).join("\n"),
          line: i + 1,
        };
      }
    }
  }

  return null;
}

/**
 * Show context lines around an occurrence index.
 *
 * @param {string} content
 * @param {number} occurrenceIndex
 * @param {number} contextLines
 * @returns {string}
 */
function showContextLines(content, occurrenceIndex, contextLines) {
  const lines = content.split("\n");
  const targetLine = content.slice(0, occurrenceIndex).split("\n").length - 1;
  const start = Math.max(0, targetLine - contextLines);
  const end = Math.min(lines.length, targetLine + contextLines + 1);

  const padWidth = String(end).length;
  return lines
    .slice(start, end)
    .map((line, i) => {
      const lineNum = String(start + i + 1).padStart(padWidth, " ");
      const marker = start + i === targetLine ? ">" : " ";
      return `${marker} ${lineNum}: ${line}`;
    })
    .join("\n");
}

/**
 * Format a text preview, showing only the first N lines.
 *
 * @param {string} text
 * @param {number} maxLines
 * @returns {string}
 */
function formatPreview(text, maxLines) {
  const lines = text.split("\n");
  const shown = lines.slice(0, maxLines);
  const preview = shown.map((l) => `  │ ${l}`).join("\n");

  if (lines.length > maxLines) {
    return preview + `\n  │ ... (${lines.length - maxLines} more lines)`;
  }

  return preview;
}

/**
 * Count the number of lines added/removed.
 *
 * @param {string} search - Original text
 * @param {string} replace - Replacement text
 * @returns {string} Human-readable change summary
 */
function countChangedLines(search, replace) {
  const oldLines = search.split("\n").length;
  const newLines = replace.split("\n").length;
  const added = Math.max(0, newLines - oldLines);
  const removed = Math.max(0, oldLines - newLines);

  const parts = [];
  if (added > 0) parts.push(`+${added}`);
  if (removed > 0) parts.push(`-${removed}`);
  if (added === 0 && removed === 0) parts.push("±0");

  return parts.join(" ") + ` line${oldLines + newLines > 2 ? "s" : ""}`;
}

/**
 * Generate a unified diff between old and new content.
 *
 * Produces output similar to `git diff`:
 *   --- a/file.js
 *   +++ b/file.js
 *   @@ -15,4 +15,5 @@
 *   -old line
 *   +new line
 *    unchanged line
 *
 * @param {string} filePath - File path for the header
 * @param {string} oldContent - Original file content
 * @param {string} newContent - Modified file content
 * @returns {string}
 */
function generateUnifiedDiff(filePath, oldContent, newContent) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Find the range of changed lines
  let firstDiff = 0;
  while (
    firstDiff < oldLines.length &&
    firstDiff < newLines.length &&
    oldLines[firstDiff] === newLines[firstDiff]
  ) {
    firstDiff++;
  }

  let lastDiffOld = oldLines.length - 1;
  let lastDiffNew = newLines.length - 1;
  while (
    lastDiffOld > firstDiff &&
    lastDiffNew > firstDiff &&
    oldLines[lastDiffOld] === newLines[lastDiffNew]
  ) {
    lastDiffOld--;
    lastDiffNew--;
  }

  // Build context window (3 lines before/after)
  const contextSize = 3;
  const startLine = Math.max(0, firstDiff - contextSize);
  const endLineOld = Math.min(oldLines.length - 1, lastDiffOld + contextSize);
  const endLineNew = Math.min(newLines.length - 1, lastDiffNew + contextSize);

  let diff = `--- a/${filePath}\n`;
  diff += `+++ b/${filePath}\n`;

  const oldCount = endLineOld - startLine + 1;
  const newCount = endLineNew - startLine + 1;
  diff += `@@ -${startLine + 1},${oldCount} +${startLine + 1},${newCount} @@\n`;

  // Context before change
  for (let i = startLine; i < firstDiff; i++) {
    diff += ` ${oldLines[i]}\n`;
  }

  // Removed lines
  for (let i = firstDiff; i <= lastDiffOld; i++) {
    diff += `-${oldLines[i]}\n`;
  }

  // Added lines
  for (let i = firstDiff; i <= lastDiffNew; i++) {
    diff += `+${newLines[i]}\n`;
  }

  // Context after change
  for (let i = lastDiffOld + 1; i <= endLineOld; i++) {
    diff += ` ${oldLines[i]}\n`;
  }

  return diff;
}

// Export helpers for testing
export {
  findAllOccurrences,
  findClosestMatch,
  showContextLines,
  formatPreview,
  countChangedLines,
  generateUnifiedDiff,
};
