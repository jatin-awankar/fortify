import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export class PluginService {
  constructor({
    cwd = process.cwd(),
    fsPromises = { readdir, readFile, stat }
  } = {}) {
    this.cwd = cwd;
    this.fs = fsPromises;
    this.pluginDir = path.join(this.cwd, ".fortify", "plugins");
    this.rulesFile = path.join(this.cwd, ".fortify", "rules.md");
  }

  async getCustomRules() {
    try {
      const stats = await this.fs.stat(this.rulesFile);
      if (stats.isFile()) {
        const content = await this.fs.readFile(this.rulesFile, "utf8");
        return content.trim();
      }
    } catch {
      // File does not exist or unreadable
    }
    return "";
  }

  async listPlugins() {
    const plugins = [];

    // Check custom rules.md
    const customRules = await this.getCustomRules();
    if (customRules) {
      plugins.push({
        name: "rules.md",
        type: "system_prompt_rules",
        path: ".fortify/rules.md",
        sizeBytes: Buffer.byteLength(customRules, "utf8")
      });
    }

    // Check .fortify/plugins directory
    try {
      const files = await this.fs.readdir(this.pluginDir);
      for (const file of files) {
        if (file.endsWith(".json") || file.endsWith(".js")) {
          const filePath = path.join(this.pluginDir, file);
          const fileStat = await this.fs.stat(filePath);
          plugins.push({
            name: file,
            type: file.endsWith(".json") ? "shortcut_definitions" : "executable_plugin",
            path: path.relative(this.cwd, filePath),
            sizeBytes: fileStat.size
          });
        }
      }
    } catch {
      // plugins directory does not exist or unreadable
    }

    return plugins;
  }

  async getShortcutsMap() {
    const shortcuts = {
      "@security-check": "Perform a security audit on the provided code, looking for OWASP vulnerabilities, injection risks, and unhandled errors.",
      "@refactor": "Analyze the provided code and suggest clean, modular refactorings prioritizing readability and performance.",
      "@explain-simple": "Explain the following code in simple, beginner-friendly terms with visual analogies."
    };

    try {
      const files = await this.fs.readdir(this.pluginDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = await this.fs.readFile(path.join(this.pluginDir, file), "utf8");
          const json = JSON.parse(content);
          if (json.shortcuts && typeof json.shortcuts === "object") {
            Object.assign(shortcuts, json.shortcuts);
          }
        }
      }
    } catch {
      // Ignore directory missing
    }

    return shortcuts;
  }

  async expandPromptShortcuts(text) {
    if (typeof text !== "string" || !text.includes("@")) {
      return text;
    }

    const shortcuts = await this.getShortcutsMap();
    let expandedText = text;

    for (const [shortcut, expansion] of Object.entries(shortcuts)) {
      if (expandedText.includes(shortcut)) {
        expandedText = expandedText.replaceAll(shortcut, `[Shortcut: ${shortcut} -> "${expansion}"]`);
      }
    }

    return expandedText;
  }
}
