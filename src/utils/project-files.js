import { readFile, readdir, stat, open } from "node:fs/promises";
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

    let entries;
    try {
      entries = await readdir(currentDirectoryPath, { withFileTypes: true });
    } catch {
      return;
    }

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
  let fileHandle;
  try {
    fileHandle = await open(filePath, "r");
    const probeBuffer = Buffer.alloc(8192);
    const { bytesRead } = await fileHandle.read(probeBuffer, 0, 8192, 0);

    if (containsNullByte(probeBuffer.subarray(0, bytesRead))) {
      return {
        content: "",
        isText: false,
        truncated: false
      };
    }

    const maxReadBytes = Math.min(maxChars * 4, 10_000_000);
    const contentBuffer = Buffer.alloc(maxReadBytes);
    const { bytesRead: contentBytesRead } = await fileHandle.read(contentBuffer, 0, maxReadBytes, 0);
    const rawText = contentBuffer.subarray(0, contentBytesRead).toString("utf8");

    if (!rawText.trim()) {
      return {
        content: "",
        isText: true,
        truncated: false
      };
    }

    const wasTruncated = (contentBytesRead === maxReadBytes) || (rawText.length > maxChars);

    if (!wasTruncated) {
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
  } finally {
    if (fileHandle) {
      await fileHandle.close();
    }
  }
}
