/**
 * Slash command registry and executor.
 *
 * Each command has:
 * - name: The slash command (e.g., "/help")
 * - description: Short help text
 * - aliases: Alternative triggers
 * - handler: async function(args, context) => void
 *
 * The handler receives:
 * - args: string after the command name (e.g., "/model gpt-4o" → "gpt-4o")
 * - context: { renderer, conversationStore, session, configLoader, ... }
 */

/** @typedef {{ name: string, description: string, aliases?: string[], handler: Function }} SlashCommand */

/**
 * Built-in slash commands for the Fortify chat REPL.
 * @returns {SlashCommand[]}
 */
function getBuiltinCommands() {
  return [
    {
      name: "/help",
      description: "Show available commands",
      aliases: ["/?"],
      handler: async (_args, ctx) => {
        const { renderer, commands } = ctx;
        const stdout = renderer.terminalUI?.stdout || process.stdout;
        const chalk = renderer.terminalUI?.chalk;

        stdout.write("\n");
        stdout.write(`  ${chalk ? chalk.bold.cyan("Available Commands") : "Available Commands"}\n\n`);

        for (const cmd of commands) {
          const aliases = cmd.aliases?.length ? ` (${cmd.aliases.join(", ")})` : "";
          const nameStr = chalk ? chalk.cyan(cmd.name) : cmd.name;
          const descStr = chalk ? chalk.dim(cmd.description) : cmd.description;
          const aliasStr = chalk ? chalk.dim(aliases) : aliases;
          stdout.write(`  ${nameStr.padEnd(20)}${descStr}${aliasStr}\n`);
        }

        stdout.write("\n");
        stdout.write(`  ${chalk ? chalk.dim("Tip: Use @filename to attach files to your prompt") : "Tip: Use @filename to attach files"}\n\n`);
      },
    },
    {
      name: "/clear",
      description: "Clear conversation history",
      aliases: [],
      handler: async (_args, ctx) => {
        const { renderer, conversationStore, session } = ctx;
        conversationStore.clearSession(session.id);
        if (renderer.messageRenderer) {
          renderer.messageRenderer.renderInfo("Conversation cleared.");
        } else {
          renderer.terminalUI?.success("Conversation cleared.");
        }
      },
    },
    {
      name: "/model",
      description: "Show or switch the active model",
      aliases: [],
      handler: async (args, ctx) => {
        const { renderer, onModelChange } = ctx;
        const newModel = args.trim();

        if (!newModel) {
          const currentModel = ctx.currentModel || "default";
          const currentProvider = ctx.currentProvider || "";
          const providerStr = currentProvider ? ` (${currentProvider})` : "";
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo(`Current model: ${currentModel}${providerStr}`);
          } else {
            renderer.terminalUI?.info(`Current model: ${currentModel}${providerStr}`);
          }
          return;
        }

        if (typeof onModelChange === "function") {
          onModelChange(newModel);
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo(`Switched to model: ${newModel}`);
          } else {
            renderer.terminalUI?.success(`Switched to model: ${newModel}`);
          }
        }
      },
    },
    {
      name: "/exit",
      description: "End the chat session",
      aliases: ["/quit", "/bye"],
      handler: async (_args, ctx) => {
        ctx.requestExit();
      },
    },
    {
      name: "/history",
      description: "Show recent conversation messages",
      aliases: [],
      handler: async (args, ctx) => {
        const { renderer, conversationStore, session } = ctx;
        const sessionObj = conversationStore.getSession(session.id);
        const messages = sessionObj?.messages || [];
        const count = parseInt(args.trim(), 10) || 10;
        const recent = messages.slice(-count);

        const stdout = renderer.terminalUI?.stdout || process.stdout;
        const chalk = renderer.terminalUI?.chalk;

        if (recent.length === 0) {
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo("No messages in this session.");
          }
          return;
        }

        stdout.write("\n");
        for (const msg of recent) {
          const role = msg.role === "user" ? "You" : "Assistant";
          const roleColor = msg.role === "user"
            ? (chalk?.cyan(role) ?? role)
            : (chalk?.green(role) ?? role);
          const preview = (msg.content || "").slice(0, 100).replace(/\n/g, " ");
          const truncated = msg.content?.length > 100 ? "..." : "";
          stdout.write(`  ${chalk?.bold(roleColor) ?? roleColor}: ${chalk?.dim(preview + truncated) ?? (preview + truncated)}\n`);
        }
        stdout.write("\n");
      },
    },
    {
      name: "/status",
      description: "Show session status and token usage",
      aliases: [],
      handler: async (_args, ctx) => {
        const { renderer, session } = ctx;
        if (renderer.statusBar) {
          renderer.statusBar.render();
        } else if (renderer.messageRenderer) {
          renderer.messageRenderer.renderInfo(`Session: ${session.id}`);
        }
      },
    },
    {
      name: "/tools",
      description: "List available agentic tools",
      aliases: [],
      handler: async (_args, ctx) => {
        const { renderer, toolRegistry } = ctx;
        const stdout = renderer.terminalUI?.stdout || process.stdout;
        const chalk = renderer.terminalUI?.chalk;

        if (!toolRegistry) {
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo("No tool registry available.");
          }
          return;
        }

        const tools = toolRegistry.getAll();
        stdout.write("\n");
        stdout.write(`  ${chalk ? chalk.bold.cyan("Available Tools") : "Available Tools"} (${tools.length})\n\n`);

        for (const tool of tools) {
          const perm = tool.requiresPermission
            ? (chalk ? chalk.yellow(` [${tool.permissionLevel}]`) : ` [${tool.permissionLevel}]`)
            : (chalk ? chalk.dim(" [auto]") : " [auto]");
          const nameStr = chalk ? chalk.cyan(tool.name) : tool.name;
          const descStr = chalk ? chalk.dim(tool.description) : tool.description;
          stdout.write(`  ${nameStr.padEnd(22)}${descStr}${perm}\n`);
        }
        stdout.write("\n");
      },
    },
    {
      name: "/memory",
      description: "Show, add, or clear project memory",
      aliases: [],
      handler: async (args, ctx) => {
        const { renderer } = ctx;
        const stdout = renderer.terminalUI?.stdout || process.stdout;
        const chalk = renderer.terminalUI?.chalk;

        // Dynamic import to avoid circular dependency at module load time
        const { MemoryService } = await import("../services/memory-service.js");
        const memoryService = new MemoryService();
        const cwd = ctx.projectContextService?.cwd || process.cwd();

        const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase() || "";
        const subArgs = args.trim().slice(subcommand.length).trim();

        if (subcommand === "add" && subArgs) {
          await memoryService.appendMemory(cwd, subArgs);
          const count = await memoryService.countEntries(cwd);
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo(`Memory entry added (${count} total entries).`);
          } else {
            renderer.terminalUI?.success(`Memory entry added (${count} total entries).`);
          }
          return;
        }

        if (subcommand === "add" && !subArgs) {
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo("Usage: /memory add <text to remember>");
          } else {
            renderer.terminalUI?.info("Usage: /memory add <text to remember>");
          }
          return;
        }

        if (subcommand === "clear") {
          await memoryService.clearMemory(cwd);
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo("Project memory cleared.");
          } else {
            renderer.terminalUI?.success("Project memory cleared.");
          }
          return;
        }

        // Default: show memory contents
        const content = await memoryService.loadMemory(cwd);
        if (!content || !content.trim()) {
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo("No project memory entries. Use /memory add <text> to create one.");
          } else {
            renderer.terminalUI?.info("No project memory entries. Use /memory add <text> to create one.");
          }
          return;
        }

        const count = await memoryService.countEntries(cwd);
        stdout.write("\n");
        stdout.write(`  ${chalk ? chalk.bold.cyan("Project Memory") : "Project Memory"} (${count} entries)\n`);
        stdout.write(`  ${chalk ? chalk.dim(memoryService.getMemoryPath(cwd)) : memoryService.getMemoryPath(cwd)}\n\n`);
        // Display entries with indentation
        const lines = content.trim().split("\n");
        for (const line of lines) {
          if (line.startsWith("## ")) {
            stdout.write(`  ${chalk ? chalk.yellow(line) : line}\n`);
          } else {
            stdout.write(`  ${chalk ? chalk.dim(line) : line}\n`);
          }
        }
        stdout.write("\n");
      },
    },
    {
      name: "/context",
      description: "Show loaded project context summary",
      aliases: [],
      handler: async (_args, ctx) => {
        const { renderer, session } = ctx;
        const stdout = renderer.terminalUI?.stdout || process.stdout;
        const chalk = renderer.terminalUI?.chalk;

        const pcs = ctx.projectContextService;
        if (!pcs) {
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo("No project context service available.");
          }
          return;
        }

        const summary = await pcs.getProjectContextSummary();

        stdout.write("\n");
        stdout.write(`  ${chalk ? chalk.bold.cyan("Project Context") : "Project Context"}\n\n`);
        stdout.write(`  ${chalk ? chalk.dim("Name:") : "Name:"}     ${summary.name}\n`);
        stdout.write(`  ${chalk ? chalk.dim("Stack:") : "Stack:"}    ${Array.isArray(summary.stack) ? summary.stack.join(", ") : summary.stack}\n`);
        stdout.write(`  ${chalk ? chalk.dim("CWD:") : "CWD:"}      ${pcs.cwd}\n`);
        stdout.write(`  ${chalk ? chalk.dim("Memory:") : "Memory:"}   ${summary.hasMemory ? chalk?.green("active") ?? "active" : chalk?.dim("none") ?? "none"}\n`);

        if (summary.git) {
          stdout.write(`  ${chalk ? chalk.dim("Branch:") : "Branch:"}   ${summary.git.branch || "unknown"}\n`);
          if (summary.git.remoteUrl) {
            stdout.write(`  ${chalk ? chalk.dim("Remote:") : "Remote:"}   ${summary.git.remoteUrl}\n`);
          }
        }

        if (summary.instructions) {
          stdout.write(`\n  ${chalk ? chalk.dim("Instructions:") : "Instructions:"}\n`);
          stdout.write(`  ${chalk ? chalk.dim(summary.instructions) : summary.instructions}\n`);
        }

        const msgs = session ? (ctx.conversationStore?.getSession(session.id)?.messages?.length || 0) : 0;
        stdout.write(`\n  ${chalk ? chalk.dim("Messages:") : "Messages:"} ${msgs}\n`);
        stdout.write("\n");
      },
    },
    {
      name: "/repo-map",
      description: "Show repository file tree with symbols",
      aliases: ["/map"],
      handler: async (args, ctx) => {
        const { renderer } = ctx;
        const stdout = renderer.terminalUI?.stdout || process.stdout;
        const chalk = renderer.terminalUI?.chalk;

        const { RepoMapService } = await import("../services/repo-map-service.js");

        const pcs = ctx.projectContextService;
        const cwd = pcs?.cwd || process.cwd();
        const maxFiles = parseInt(args.trim(), 10) || 100;

        const repoMapService = new RepoMapService({
          gitService: pcs?.gitService,
        });

        const repoMap = await repoMapService.generateRepoMap({
          cwd,
          includeSymbols: true,
          maxFiles,
        });
        const formatted = repoMapService.formatForPrompt(repoMap, {
          maxTokens: 5000,
          showSymbols: true,
        });

        if (!formatted) {
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo("No files found in the repository.");
          } else {
            renderer.terminalUI?.info("No files found in the repository.");
          }
          return;
        }

        stdout.write("\n");
        const lines = formatted.split("\n");
        for (const line of lines) {
          if (line.startsWith("[Repository Map]")) {
            stdout.write(`  ${chalk ? chalk.bold.cyan(line) : line}\n`);
          } else if (line.endsWith("/")) {
            stdout.write(`  ${chalk ? chalk.blue(line) : line}\n`);
          } else {
            stdout.write(`  ${chalk ? chalk.dim(line) : line}\n`);
          }
        }
        stdout.write("\n");
      },
    },
    {
      name: "/undo",
      description: "Undo the last agentic change (restore checkpoint)",
      aliases: ["/rollback"],
      handler: async (args, ctx) => {
        const { renderer } = ctx;
        const stdout = renderer.terminalUI?.stdout || process.stdout;
        const chalk = renderer.terminalUI?.chalk;

        // Use injected service or create a new one
        let checkpointService = ctx.gitCheckpointService;
        if (!checkpointService) {
          const { GitCheckpointService } = await import("../services/git-checkpoint-service.js");
          const { GitService } = await import("../services/git-service.js");
          const cwd = ctx.projectContextService?.cwd || process.cwd();
          const gitService = ctx.projectContextService?.gitService || new GitService({ cwd });
          checkpointService = new GitCheckpointService({ gitService, cwd });
        }

        const cwd = ctx.projectContextService?.cwd || process.cwd();
        const subcommand = args.trim().toLowerCase();

        // /undo list — show all checkpoints
        if (subcommand === "list") {
          const checkpoints = await checkpointService.listCheckpoints({ cwd });
          if (checkpoints.length === 0) {
            if (renderer.messageRenderer) {
              renderer.messageRenderer.renderInfo("No Fortify checkpoints found.");
            } else {
              renderer.terminalUI?.info("No Fortify checkpoints found.");
            }
            return;
          }

          stdout.write("\n");
          stdout.write(`  ${chalk ? chalk.bold.cyan("Fortify Checkpoints") : "Fortify Checkpoints"} (${checkpoints.length})\n\n`);
          for (const cp of checkpoints) {
            const idx = chalk ? chalk.yellow(`[${cp.index}]`) : `[${cp.index}]`;
            const ts = chalk ? chalk.dim(cp.timestamp) : cp.timestamp;
            const label = chalk ? chalk.cyan(cp.label) : cp.label;
            stdout.write(`  ${idx} ${ts}  ${label}\n`);
          }
          stdout.write(`\n  ${chalk ? chalk.dim("Use /undo <index> to restore a specific checkpoint.") : "Use /undo <index> to restore."}\n\n`);
          return;
        }

        // /undo <N> — restore specific checkpoint
        const specificIndex = parseInt(subcommand, 10);
        const restoreOptions = { cwd };
        if (!isNaN(specificIndex)) {
          restoreOptions.index = specificIndex;
        }

        // Show what will be reverted
        const diffSummary = await checkpointService.getDiffSummary({ cwd });

        const result = await checkpointService.restoreCheckpoint(restoreOptions);

        if (!result.restored) {
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderError(result.error || "Failed to restore checkpoint.");
          } else {
            renderer.terminalUI?.error(result.error || "Failed to restore checkpoint.");
          }
          return;
        }

        // Success
        if (renderer.messageRenderer) {
          renderer.messageRenderer.renderInfo("Checkpoint restored — changes reverted.");
        } else {
          renderer.terminalUI?.success("Checkpoint restored — changes reverted.");
        }

        if (diffSummary) {
          stdout.write(`\n  ${chalk ? chalk.dim("Reverted changes:") : "Reverted changes:"}\n`);
          const lines = diffSummary.split("\n");
          for (const line of lines) {
            stdout.write(`  ${chalk ? chalk.dim(line) : line}\n`);
          }
          stdout.write("\n");
        }
      },
    },
    {
      name: "/diff",
      description: "Show uncommitted changes from the current session",
      aliases: [],
      handler: async (args, ctx) => {
        const { renderer } = ctx;
        const stdout = renderer.terminalUI?.stdout || process.stdout;
        const chalk = renderer.terminalUI?.chalk;

        // Use injected service or create a new one
        let checkpointService = ctx.gitCheckpointService;
        if (!checkpointService) {
          const { GitCheckpointService } = await import("../services/git-checkpoint-service.js");
          const { GitService } = await import("../services/git-service.js");
          const cwd = ctx.projectContextService?.cwd || process.cwd();
          const gitService = ctx.projectContextService?.gitService || new GitService({ cwd });
          checkpointService = new GitCheckpointService({ gitService, cwd });
        }

        const cwd = ctx.projectContextService?.cwd || process.cwd();
        const trimmedArgs = args.trim();

        // Check for --stat flag
        if (trimmedArgs === "--stat") {
          const summary = await checkpointService.getDiffSummary({ cwd });
          if (!summary) {
            if (renderer.messageRenderer) {
              renderer.messageRenderer.renderInfo("No uncommitted changes.");
            } else {
              renderer.terminalUI?.info("No uncommitted changes.");
            }
            return;
          }

          stdout.write("\n");
          stdout.write(`  ${chalk ? chalk.bold.cyan("Changes Summary") : "Changes Summary"}\n\n`);
          const lines = summary.split("\n");
          for (const line of lines) {
            stdout.write(`  ${chalk ? chalk.dim(line) : line}\n`);
          }
          stdout.write("\n");
          return;
        }

        // Check for uncommitted changes
        const hasChanges = await checkpointService.hasUncommittedChanges({ cwd });
        if (!hasChanges) {
          if (renderer.messageRenderer) {
            renderer.messageRenderer.renderInfo("No uncommitted changes.");
          } else {
            renderer.terminalUI?.info("No uncommitted changes.");
          }
          return;
        }

        // Get per-file diffs (optionally filtered by path)
        const filePath = trimmedArgs || undefined;
        const fileDiffs = await checkpointService.getPerFileDiffs({ cwd, filePath });

        if (fileDiffs.length === 0) {
          if (filePath) {
            if (renderer.messageRenderer) {
              renderer.messageRenderer.renderInfo(`No changes found for: ${filePath}`);
            } else {
              renderer.terminalUI?.info(`No changes found for: ${filePath}`);
            }
          } else {
            if (renderer.messageRenderer) {
              renderer.messageRenderer.renderInfo("No diff output available.");
            } else {
              renderer.terminalUI?.info("No diff output available.");
            }
          }
          return;
        }

        // Render each file diff using DiffRenderer if available, otherwise plain output
        const { DiffRenderer } = await import("./diff-renderer.js");
        const diffRenderer = new DiffRenderer({ terminalUI: renderer.terminalUI });

        stdout.write("\n");
        for (const fd of fileDiffs) {
          diffRenderer.renderDiffCard(fd.file, fd.diff, {
            additions: fd.additions,
            deletions: fd.deletions,
          });
        }

        // Show totals
        const totalAdditions = fileDiffs.reduce((sum, f) => sum + f.additions, 0);
        const totalDeletions = fileDiffs.reduce((sum, f) => sum + f.deletions, 0);
        const addStr = chalk ? chalk.green(`+${totalAdditions}`) : `+${totalAdditions}`;
        const delStr = chalk ? chalk.red(`-${totalDeletions}`) : `-${totalDeletions}`;
        stdout.write(`\n  ${chalk ? chalk.bold(`${fileDiffs.length} file${fileDiffs.length === 1 ? "" : "s"} changed`) : `${fileDiffs.length} file(s) changed`}  ${addStr}  ${delStr}\n\n`);
      },
    },
  ];
}

export class SlashCommandHandler {
  #commands = new Map();
  #aliases = new Map();

  constructor({ customCommands = [] } = {}) {
    // Register built-in commands
    for (const cmd of getBuiltinCommands()) {
      this.register(cmd);
    }

    // Register custom commands (override built-ins if same name)
    for (const cmd of customCommands) {
      this.register(cmd);
    }
  }

  /**
   * Register a slash command.
   * @param {SlashCommand} command
   */
  register(command) {
    this.#commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.#aliases.set(alias, command.name);
      }
    }
  }

  /**
   * Check if an input string is a slash command.
   * @param {string} input - User input string
   * @returns {boolean}
   */
  isSlashCommand(input) {
    if (!input || typeof input !== "string") return false;
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return false;

    const commandName = trimmed.split(/\s+/)[0].toLowerCase();
    return this.#commands.has(commandName) || this.#aliases.has(commandName);
  }

  /**
   * Execute a slash command.
   *
   * @param {string} input - Full user input (e.g., "/model gpt-4o")
   * @param {object} context - Execution context
   * @returns {Promise<boolean>} true if the command was handled, false otherwise
   */
  async execute(input, context) {
    if (!input || typeof input !== "string") return false;
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return false;

    const parts = trimmed.split(/\s+/);
    const commandName = parts[0].toLowerCase();
    const args = trimmed.slice(commandName.length).trim();

    // Resolve alias → canonical name
    const canonicalName = this.#aliases.get(commandName) || commandName;
    const command = this.#commands.get(canonicalName);

    if (!command) return false;

    // Build context with command list for /help
    const fullContext = {
      ...context,
      commands: this.getCommands(),
    };

    try {
      await command.handler(args, fullContext);
    } catch (error) {
      const renderer = context.renderer;
      const message = error instanceof Error ? error.message : "Command failed.";
      if (renderer?.messageRenderer) {
        renderer.messageRenderer.renderError(`/${command.name}: ${message}`);
      } else if (renderer?.terminalUI) {
        renderer.terminalUI.error(`/${command.name}: ${message}`);
      }
    }

    return true;
  }

  /**
   * Get all registered commands (for tab completion and help).
   * @returns {SlashCommand[]}
   */
  getCommands() {
    return Array.from(this.#commands.values());
  }

  /**
   * Get command names (for tab completion).
   * @returns {string[]}
   */
  getCommandNames() {
    const names = [];
    for (const cmd of this.#commands.values()) {
      names.push(cmd.name);
      if (cmd.aliases) {
        names.push(...cmd.aliases);
      }
    }
    return names;
  }
}

/**
 * Create a SlashCommandHandler instance.
 * @param {object} [options]
 * @returns {SlashCommandHandler}
 */
export function createSlashCommandHandler(options) {
  return new SlashCommandHandler(options);
}
