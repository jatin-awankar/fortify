import { createTerminalUI } from "../renderers/index.js";
import { LocalHistoryStore } from "../storage/local-history-store.js";

export class HistoryService {
  constructor({
    historyStore = new LocalHistoryStore(),
    terminalUI = createTerminalUI()
  } = {}) {
    this.historyStore = historyStore;
    this.terminalUI = terminalUI;
  }

  async showHistory({ list = false, show = "", clear = false } = {}) {
    try {
      if (clear) {
        await this.historyStore.clearHistory();
        this.terminalUI.success("Chat history cleared.");
        return { ok: true, cleared: true };
      }

      const showSessionId = typeof show === "string" ? show.trim() : "";
      if (showSessionId) {
        return await this.#showSession(showSessionId);
      }

      void list;
      return await this.#listSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read local history.";
      this.terminalUI.error(message);
      return { ok: false, error };
    }
  }

  async #listSessions() {
    const sessions = await this.historyStore.listSessions();
    const historyDir = this.historyStore.getHistoryDirectory();

    this.terminalUI.divider("Fortify History");
    this.terminalUI.info(`Location: ${historyDir}`);

    if (!sessions.length) {
      this.terminalUI.info("No saved conversations found.");
      return { ok: true, sessions: [] };
    }

    const headers = ["Session ID", "Messages", "Last Updated"];
    const rows = sessions.map((s) => [
      s.id,
      String(Number.isFinite(s.messageCount) ? s.messageCount : 0),
      s.updatedAt || "N/A"
    ]);

    if (typeof this.terminalUI.table === "function") {
      this.terminalUI.table(headers, rows);
    } else {
      for (const session of sessions) {
        const messageCount = Number.isFinite(session.messageCount) ? session.messageCount : 0;
        this.terminalUI.stdout.write(
          `${this.terminalUI.chalk.yellow(session.id)}  messages=${messageCount}  updated=${session.updatedAt}\n`
        );
      }
    }

    return { ok: true, sessions };
  }

  async #showSession(sessionId) {
    const session = await this.historyStore.loadSession(sessionId);

    if (!session) {
      this.terminalUI.warning(`No history found for session '${sessionId}'.`);
      return { ok: false, reason: "not_found" };
    }

    this.terminalUI.divider(`History: ${session.id}`);
    this.terminalUI.info(`Created: ${session.createdAt}`);
    this.terminalUI.info(`Updated: ${session.updatedAt}`);
    this.terminalUI.info(`Messages: ${session.messages.length}`);
    this.terminalUI.divider();

    for (const message of session.messages) {
      const roleLabel = (message.role || "user").toUpperCase();
      this.terminalUI.stdout.write(`[${roleLabel}] ${message.content}\n`);
    }

    return { ok: true, session };
  }
}
