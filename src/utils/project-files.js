import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".fortify",
  "build",
  "out",
  ".cache",
  ".coverage",
  "coverage"
]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".md",
  ".mdx",
  ".txt",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".xml",
  ".svg",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".php",
  ".sh",
  ".ps1",
  ".bat",
  ".sql",
  ".graphql",
  ".gql",
  ".env"
]);
const TEXT_FILE_BASENAMES = new Set([
  "dockerfile",
  "makefile",
  "readme",
  "license",
  ".gitignore",
  ".npmignore"
]);

function isPotentiallyTextFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  const baseName = path.basename(filePath).toLowerCase();
  if (TEXT_FILE_BASENAMES.has(baseName)) {
    return true;
  }

  return extension === "";
}

function containsNullByte(buffer) {
  const probeLength = Math.min(buffer.length, 8_192);
  for (let index = 0; index < probeLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }

  return false;
}

export async function resolveSourcePath(sourcePath, { cwd = process.cwd() } = {}) {
  const absolutePath = path.resolve(cwd, sourcePath);
  const sourceStats = await stat(absolutePath);
  return {
    absolutePath,
    sourceStats
  };
}

export async function collectProjectTextFiles(
  rootPath,
  { maxFiles = 200, ignoredDirectoryNames = IGNORED_DIRECTORY_NAMES } = {}
) {
  const discoveredFiles = [];

  async function walkDirectory(currentDirectoryPath) {
    if (discoveredFiles.length >= maxFiles) {
      return;
    }

    const entries = await readdir(currentDirectoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (discoveredFiles.length >= maxFiles) {
        return;
      }

      const absoluteEntryPath = path.join(currentDirectoryPath, entry.name);

      if (entry.isDirectory()) {
        if (ignoredDirectoryNames.has(entry.name)) {
          continue;
        }

        await walkDirectory(absoluteEntryPath);
        continue;
      }

      if (entry.isFile() && isPotentiallyTextFile(absoluteEntryPath)) {
        discoveredFiles.push(absoluteEntryPath);
      }
    }
  }

  await walkDirectory(rootPath);
  discoveredFiles.sort((left, right) => left.localeCompare(right));
  return discoveredFiles;
}

export async function readTextFileForSummary(
  filePath,
  { maxChars = 80_000 } = {}
) {
  const fileBuffer = await readFile(filePath);

  if (containsNullByte(fileBuffer)) {
    return {
      content: "",
      isText: false,
      truncated: false
    };
  }

  const rawText = fileBuffer.toString("utf8");
  if (!rawText.trim()) {
    return {
      content: "",
      isText: true,
      truncated: false
    };
  }

  if (rawText.length <= maxChars) {
    return {
      content: rawText,
      isText: true,
      truncated: false
    };
  }

  return {
    content: rawText.slice(0, maxChars),
    isText: true,
    truncated: true
  };
}
