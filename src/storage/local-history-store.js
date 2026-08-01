import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const HISTORY_DIR_NAME = ".fortify";
const HISTORY_SUBDIR_NAME = "history";
const HISTORY_FILE_EXTENSION = ".json";

const DEFAULT_LIMITS = {
  maxSessionFiles: 200,
  maxMessagesPerSession: 400,
  maxMessageChars: 8_000,
  maxTotalBytes: 8 * 1024 * 1024
};

function normalizeSessionId(sessionId) {
  const fallback = "default";
  if (typeof sessionId !== "string") {
    return fallback;
  }

  const trimmed = sessionId.trim();
  if (!trimmed) {
    return fallback;
  }

  let cleaned = trimmed.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80) || fallback;
  const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (WINDOWS_RESERVED.test(cleaned)) {
    cleaned = `${cleaned}_session`;
  }
  return cleaned;
}

function normalizeMessage(message, limits) {
  const role =
    message?.role === "assistant" || message?.role === "system" || message?.role === "developer"
      ? message.role
      : "user";
  const createdAt = typeof message?.createdAt === "string" ? message.createdAt : new Date().toISOString();
  const rawContent = typeof message?.content === "string" ? message.content : String(message?.content ?? "");

  return {
    role,
    content: rawContent.slice(0, limits.maxMessageChars),
    createdAt
  };
}

function normalizeSessionPayload(payload, limits) {
  const id = normalizeSessionId(payload?.id);
  const createdAt = typeof payload?.createdAt === "string" ? payload.createdAt : new Date().toISOString();
  const rawMessages = Array.isArray(payload?.messages) ? payload.messages : [];

  const systemMessages = rawMessages.filter((m) => m?.role === "system");
  const nonSystemMessages = rawMessages.filter((m) => m?.role !== "system");

  const slicedNonSystem = nonSystemMessages.slice(-limits.maxMessagesPerSession);
  const messages = [...systemMessages, ...slicedNonSystem];

  return {
    id,
    createdAt,
    messages: messages.map((message) => normalizeMessage(message, limits)),
    updatedAt: typeof payload?.updatedAt === "string" ? payload.updatedAt : new Date().toISOString()
  };
}

export class LocalHistoryStore {
  constructor({
    baseDirectory,
    limits = DEFAULT_LIMITS
  } = {}) {
    this.baseDirectory = baseDirectory ?? path.join(homedir(), HISTORY_DIR_NAME, HISTORY_SUBDIR_NAME);
    this.limits = {
      ...DEFAULT_LIMITS,
      ...limits
    };
  }

  getHistoryDirectory() {
    return this.baseDirectory;
  }

  getSessionFilePath(sessionId) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    return path.join(this.getHistoryDirectory(), `${normalizedSessionId}${HISTORY_FILE_EXTENSION}`);
  }

  async ensureHistoryDirectory() {
    await mkdir(this.getHistoryDirectory(), { recursive: true });
  }

  async saveSession(session) {
    const normalizedSession = normalizeSessionPayload(session, this.limits);
    await this.ensureHistoryDirectory();
    await this.#enforceHistoryLimits();

    const filePath = this.getSessionFilePath(normalizedSession.id);
    const serialized = `${JSON.stringify(normalizedSession, null, 2)}\n`;
    await writeFile(filePath, serialized, "utf8");
    return normalizedSession;
  }

  async loadSession(sessionId) {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return normalizeSessionPayload(parsed, this.limits);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async listSessions() {
    await this.ensureHistoryDirectory();

    const entries = await readdir(this.getHistoryDirectory(), { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(HISTORY_FILE_EXTENSION))
      .map((entry) => entry.name)
      .slice(0, this.limits.maxSessionFiles);

    const sessions = [];
    for (const fileName of files) {
      const sessionId = fileName.slice(0, -HISTORY_FILE_EXTENSION.length);
      const filePath = path.join(this.getHistoryDirectory(), fileName);
      try {
        const details = await stat(filePath);
        const session = await this.loadSession(sessionId);

        const mtimeMs = Number.isFinite(details.mtimeMs) ? details.mtimeMs : Date.now();
        const birthMs = Number.isFinite(details.birthtimeMs) && details.birthtimeMs > 0 ? details.birthtimeMs : mtimeMs;

        sessions.push({
          id: sessionId,
          createdAt: new Date(birthMs).toISOString(),
          updatedAt: new Date(mtimeMs).toISOString(),
          messageCount: Array.isArray(session?.messages) ? session.messages.length : 0
        });
      } catch {
        // Skip corrupted or unreadable history files
      }
    }

    sessions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return sessions;
  }

  async clearHistory() {
    await rm(this.getHistoryDirectory(), { recursive: true, force: true });
    await this.ensureHistoryDirectory();
  }

  async #enforceHistoryLimits() {
    const directoryPath = this.getHistoryDirectory();
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(HISTORY_FILE_EXTENSION)) {
        continue;
      }

      const filePath = path.join(directoryPath, entry.name);
      const details = await stat(filePath);
      files.push({
        filePath,
        size: details.size,
        mtimeMs: details.mtimeMs
      });
    }

    files.sort((left, right) => left.mtimeMs - right.mtimeMs);

    let totalBytes = files.reduce((accumulator, item) => accumulator + item.size, 0);
    while (
      files.length >= this.limits.maxSessionFiles ||
      totalBytes > this.limits.maxTotalBytes
    ) {
      const oldest = files.shift();
      if (!oldest) {
        break;
      }

      await rm(oldest.filePath, { force: true });
      totalBytes -= oldest.size;
    }
  }
}
