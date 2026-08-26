import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GitService } from "./git-service.js";

const MEMORY_FILENAME = "memory.md";

export class ProjectContextService {
  constructor({
    cwd = process.cwd(),
    gitService = new GitService({ cwd }),
    fsPromises = { access, mkdir, readFile, writeFile }
  } = {}) {
    this.cwd = cwd;
    this.gitService = gitService;
    this.fs = fsPromises;
  }

  getProjectDirectory() {
    return path.join(this.cwd, ".fortify");
  }

  getProjectConfigPath() {
    return path.join(this.getProjectDirectory(), "project.json");
  }

  /**
   * Get the path to the project memory file.
   * @returns {string}
   */
  getMemoryPath() {
    return path.join(this.getProjectDirectory(), MEMORY_FILENAME);
  }

  async loadProjectConfig() {
    const configPath = this.getProjectConfigPath();
    try {
      const data = await this.fs.readFile(configPath, "utf8");
      return JSON.parse(data);
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  }

  async saveProjectConfig(config) {
    const dirPath = this.getProjectDirectory();
    const configPath = this.getProjectConfigPath();
    await this.fs.mkdir(dirPath, { recursive: true });
    await this.fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  }

  async detectStack() {
    const detected = [];
    const signatures = [
      { file: "package.json", stack: "Node.js" },
      { file: "tsconfig.json", stack: "TypeScript" },
      { file: "requirements.txt", stack: "Python" },
      { file: "Pipfile", stack: "Python" },
      { file: "pyproject.toml", stack: "Python" },
      { file: "Cargo.toml", stack: "Rust" },
      { file: "go.mod", stack: "Go" },
      { file: "pom.xml", stack: "Java" },
      { file: "build.gradle", stack: "Java" },
      { file: "composer.json", stack: "PHP" },
      { file: "Gemfile", stack: "Ruby" },
      { file: "CMakeLists.txt", stack: "C/C++" },
      { file: "Makefile", stack: "C/C++" },
      { file: "pubspec.yaml", stack: "Flutter/Dart" },
      { file: "deno.json", stack: "Deno" },
      { file: "bun.lockb", stack: "Bun" }
    ];

    for (const sig of signatures) {
      try {
        await this.fs.access(path.join(this.cwd, sig.file));
        if (!detected.includes(sig.stack)) {
          detected.push(sig.stack);
        }
      } catch {
        // file doesn't exist or isn't accessible, ignore
      }
    }

    return detected.length > 0 ? detected : ["Unknown"];
  }

  async getProjectContextSummary() {
    const config = await this.loadProjectConfig();
    const isGit = await this.gitService.isGitRepository();
    
    let branch = null;
    let recentCommits = [];
    let remoteUrl = null;

    if (isGit) {
      try {
        branch = await this.gitService.getCurrentBranchName();
        recentCommits = await this.gitService.getRecentCommits({ count: 3 });
        remoteUrl = await this.gitService.getRemoteUrl();
      } catch (err) {
        // Fail silently
      }
    }

    const detectedStack = await this.detectStack();
    const stack = config?.stack || detectedStack;
    const instructions = config?.instructions || "";
    const name = config?.name || (isGit ? path.basename(this.cwd) : "unnamed-project");

    // Check for memory file existence
    let hasMemory = false;
    try {
      await this.fs.access(path.join(this.cwd, ".fortify", MEMORY_FILENAME));
      hasMemory = true;
    } catch {
      // No memory file
    }

    return {
      name,
      stack,
      instructions,
      hasMemory,
      git: isGit ? {
        branch,
        recentCommits,
        remoteUrl
      } : null
    };
  }

  /**
   * Format project context for the system prompt.
   *
   * Returns project metadata ONLY (name, stack, git info).
   * Identity/persona text is NOT included — the agentic system prompt builder
   * adds its own identity block to avoid duplication.
   *
   * @param {object} summary - From getProjectContextSummary()
   * @returns {string} Project context block for the system prompt
   */
  formatSystemPromptContext(summary) {
    let prompt = `[Project Context]\nName: ${summary.name}\nStack: ${Array.isArray(summary.stack) ? summary.stack.join(", ") : summary.stack}\n`;
    if (summary.instructions) {
      prompt += `Custom Guidelines/Memory: ${summary.instructions}\n`;
    }
    if (summary.git) {
      prompt += `Git Branch: ${summary.git.branch || "unknown"}\n`;
      if (summary.git.remoteUrl) {
        prompt += `Git Remote: ${summary.git.remoteUrl}\n`;
      }
      if (summary.git.recentCommits && summary.git.recentCommits.length > 0) {
        prompt += `Recent Commits:\n${summary.git.recentCommits.map(c => `  - ${c}`).join("\n")}\n`;
      }
    }
    return prompt;
  }

  /**
   * Format a complete system prompt with identity + project context.
   *
   * Used by non-agentic services (explain, commit) that need the full prompt
   * but don't use the agentic prompt builder.
   *
   * @param {object} summary - From getProjectContextSummary()
   * @returns {string} Full system prompt with identity and context
   */
  formatFullSystemPrompt(summary) {
    const identity = "You are Fortify, an AI-powered developer terminal assistant. Respond directly, concisely, and cleanly in markdown. Do NOT output internal draft monologues, thought processes, or reasoning lists.";
    return `${identity}\n\n${this.formatSystemPromptContext(summary)}`;
  }
}
