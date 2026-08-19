import { createInterface } from "node:readline/promises";
import { ChatSessionRenderer } from "../renderers/index.js";
import { InMemoryConversationStore } from "../storage/in-memory-conversation-store.js";
import { LocalHistoryStore } from "../storage/local-history-store.js";
import {
  bindCtrlCCancellation,
  isAbortLikeError
} from "../utils/operation-cancellation.js";
import { OpenAIService } from "./openai/index.js";
import { ProviderFactory } from "./provider-factory.js";
import { ProjectContextService } from "./project-context-service.js";
import { PluginService } from "./plugin-service.js";
import { SlashCommandHandler } from "../renderers/slash-command-handler.js";
import { ToolRegistry } from "./tool-registry.js";
import { ToolExecutor } from "./tool-executor.js";
import { AgenticLoop } from "./agentic-loop.js";
import { registerAllHandlers } from "../tools/index.js";
import { createFortifyIgnore } from "../config/fortifyignore.js";
import { createCommandAllowlist } from "../config/command-allowlist.js";
import { loadConfig } from "../config/index.js";
import { stat, readFile, readdir, open } from "node:fs/promises";
import path from "node:path";

function normalizeSessionId(sessionId) {
  if (typeof sessionId === "string" && sessionId.trim()) {
    return sessionId.trim();
  }

  return "default";
}

export class ChatService {
  constructor({
    openAIService = new OpenAIService(),
    providerFactory = new ProviderFactory(),
    conversationStore = new InMemoryConversationStore(),
    historyStore = new LocalHistoryStore(),
    renderer = new ChatSessionRenderer(),
    projectContextService = new ProjectContextService(),
    pluginService = new PluginService(),
    configLoader = loadConfig,
    fsPromises = { stat, readFile, readdir, open },
    input = process.stdin,
    output = process.stdout,
    signalProcess = process,
    slashCommandHandler,
    toolRegistry,
    toolExecutor,
    agenticLoop,
  } = {}) {
    this.openAIService = openAIService;
    this.providerFactory = providerFactory;
    this.conversationStore = conversationStore;
    this.historyStore = historyStore;
    this.renderer = renderer;
    this.projectContextService = projectContextService;
    this.pluginService = pluginService;
    this.configLoader = configLoader;
    this.fs = fsPromises;
    this.input = input;
    this.output = output;
    this.signalProcess = signalProcess;
    this.historyPersistenceDisabled = false;
    this.slashCommandHandler = slashCommandHandler || new SlashCommandHandler();

    // Agentic tool execution
    this.toolRegistry = toolRegistry || new ToolRegistry();
    this.toolExecutor = toolExecutor || new ToolExecutor({
      toolRegistry: this.toolRegistry,
      stdout: output,
    });

    // Register all real tool handlers
    registerAllHandlers(this.toolExecutor);

    // Shared tool context — injected into every handler call
    this.commandAllowlist = createCommandAllowlist();

    this.agenticLoop = agenticLoop || new AgenticLoop({
      toolRegistry: this.toolRegistry,
      toolExecutor: this.toolExecutor,
    });
  }

  async resolveSessionId(sessionId) {
    let resolvedSessionId = normalizeSessionId(sessionId);
    if (sessionId === "latest") {
      try {
        const sessions = await this.historyStore.listSessions();
        if (sessions.length > 0) {
          resolvedSessionId = sessions[0].id;
          if (this.renderer.terminalUI && typeof this.renderer.terminalUI.info === "function") {
            this.renderer.terminalUI.info(`Resuming latest session '${resolvedSessionId}'`);
          }
        } else {
          if (this.renderer.terminalUI && typeof this.renderer.terminalUI.warning === "function") {
            this.renderer.terminalUI.warning("No recent sessions found. Creating new session 'latest'.");
          }
        }
      } catch {
        // Retain 'latest' if history load fails
      }
    }
    return resolvedSessionId;
  }

  async startInteractiveChat({ mode = "default", sessionId = "", provider = "", model = "" } = {}) {
    const resolvedSessionId = await this.resolveSessionId(sessionId);
    const existingSession = await this.#loadSessionFromHistory(resolvedSessionId);
    const session = existingSession
      ? this.conversationStore.hydrateSession(existingSession)
      : this.conversationStore.getOrCreateSession(resolvedSessionId);

    let currentModel = model || "default";
    let currentProvider = provider || "";

    const contextSummary = await this.projectContextService.getProjectContextSummary();
    const contextPrompt = this.projectContextService.formatSystemPromptContext(contextSummary);
    this.renderer.terminalUI.success(`Loaded project context: ${contextSummary.name} (${contextSummary.stack.join(", ")})`);

    // Load ignore patterns for tool handlers
    try {
      this._fortifyIgnore = await createFortifyIgnore({
        cwd: this.projectContextService.cwd,
      });
    } catch {
      // Continue without ignore patterns if loading fails
      this._fortifyIgnore = null;
    }

    const readlineInterface = createInterface({
      input: this.input,
      output: this.output,
      terminal: true,
      historySize: 200,
      removeHistoryDuplicates: true,
      completer: (line, callback) => {
        this.autocompleteCompleter(line)
          .then((result) => callback(null, result))
          .catch(() => callback(null, [[], line]));
      }
    });

    let exitRequested = false;
    let promptAbortController = null;
    let generationAbortController = null;

    const unbindSigint = bindCtrlCCancellation({
      signalProcess: this.signalProcess,
      onCancel: () => {
        exitRequested = true;

        if (generationAbortController && !generationAbortController.signal.aborted) {
          generationAbortController.abort(new Error("Cancelled by Ctrl+C."));
        }

        if (promptAbortController && !promptAbortController.signal.aborted) {
          promptAbortController.abort(new Error("Interrupted by Ctrl+C."));
        }
      }
    });

    this.renderer.showSessionStart({
      mode,
      sessionId: session.id,
      model: currentModel,
      provider: currentProvider,
      cwd: this.projectContextService.cwd,
    });

    try {
      while (!exitRequested) {
        promptAbortController = new AbortController();
        const userInput = await this.#readUserInput(readlineInterface, () => {
          return promptAbortController;
        });

        promptAbortController = null;

        if (userInput === null) {
          exitRequested = true;
          break;
        }

        const trimmedInput = userInput.trim();
        if (!trimmedInput) {
          continue;
        }

        // Handle slash commands via SlashCommandHandler
        if (this.slashCommandHandler.isSlashCommand(trimmedInput)) {
          const handled = await this.slashCommandHandler.execute(trimmedInput, {
            renderer: this.renderer,
            conversationStore: this.conversationStore,
            session,
            configLoader: this.configLoader,
            currentModel,
            currentProvider,
            toolRegistry: this.toolRegistry,
            requestExit: () => { exitRequested = true; },
            onModelChange: (newModel) => { currentModel = newModel; },
          });
          if (handled) {
            if (exitRequested) break;
            continue;
          }
        }

        // Legacy exit check (for "exit", "quit" without slash)
        if (this.#isExitCommand(trimmedInput)) {
          exitRequested = true;
          break;
        }

        const finalContent = await this.pluginService.expandPromptShortcuts(trimmedInput);
        const { content: attachedInput } = await this.resolveFileAttachments(finalContent);

        this.conversationStore.addMessage(session.id, {
          role: "user",
          content: attachedInput
        });
        await this.#persistSession(session.id);

        const responseInput = this.conversationStore.toResponseInput(session.id);
        responseInput.unshift({
          role: "system",
          content: contextPrompt
        });

        generationAbortController = new AbortController();

        try {
          const providerService = await this.providerFactory.getProvider(currentProvider);
          const stream = providerService.streamResponse({
            input: responseInput,
            model: currentModel !== "default" ? currentModel : undefined,
            signal: generationAbortController.signal,
            onModelFallback: ({ fromModel, toModel }) => {
              this.renderer.showModelFallback({ fromModel, toModel });
              if (this.renderer.terminalUI && typeof this.renderer.terminalUI.warning === "function") {
                this.renderer.terminalUI.warning(`Context window limits may change for fallback model '${toModel}'.`);
              }
            },
          });

          const assistantMessage = await this.renderer.renderAssistantStream(stream, {
            signal: generationAbortController.signal
          });

          if (assistantMessage) {
            this.conversationStore.addMessage(session.id, {
              role: "assistant",
              content: assistantMessage
            });
            await this.#persistSession(session.id);
          }
        } catch (error) {
          if (generationAbortController.signal.aborted || isAbortLikeError(error)) {
            exitRequested = true;
            continue;
          }

          this.renderer.showError(error instanceof Error ? error.message : "Chat request failed.");
        } finally {
          generationAbortController = null;
        }
      }
    } finally {
      if (promptAbortController && !promptAbortController.signal.aborted) {
        promptAbortController.abort(new Error("Chat session closed."));
      }

      if (generationAbortController && !generationAbortController.signal.aborted) {
        generationAbortController.abort(new Error("Chat session closed."));
      }

      unbindSigint();
      readlineInterface.close();
      await this.#persistSession(session.id);
      this.renderer.showSessionEnd();
    }
  }

  /**
   * Run a single agentic turn — LLM ↔ tool execution loop.
   *
   * @param {object} options
   * @param {string} options.sessionId - Session ID
   * @param {string} options.userMessage - The user's message
   * @param {string} options.contextPrompt - System prompt with project context
   * @param {string} [options.model] - Model to use
   * @param {string} [options.provider] - Provider to use
   * @param {AbortSignal} [options.signal] - Abort signal
   * @returns {Promise<{ text: string, toolResults: object[], iterations: number }>}
   */
  async runAgenticTurn({ sessionId, userMessage, contextPrompt, model, provider, signal } = {}) {
    const responseInput = this.conversationStore.toResponseInput(sessionId);
    responseInput.unshift({ role: "system", content: contextPrompt });

    const providerService = await this.providerFactory.getProvider(provider || "");
    const toolSchemas = this.getToolSchemas();

    const result = await this.agenticLoop.run({
      messages: responseInput,
      sendToLLM: async (messages, tools) => {
        const response = await providerService.createResponse({
          input: messages,
          model: model && model !== "default" ? model : undefined,
          tools: tools && tools.length > 0 ? tools : undefined,
          signal,
        });
        return AgenticLoop.parseResponse(response);
      },
      context: {
        sessionId,
        cwd: this.projectContextService.cwd,
        commandAllowlist: this.commandAllowlist,
        fortifyIgnore: this._fortifyIgnore,
      },
      signal,
    });

    // Persist the final assistant response
    if (result.text) {
      this.conversationStore.addMessage(sessionId, {
        role: "assistant",
        content: result.text,
      });
      await this.#persistSession(sessionId);
    }

    return result;
  }

  /**
   * Get tool schemas for LLM function calling.
   * @returns {object[]}
   */
  getToolSchemas() {
    return this.toolRegistry.toFunctionCallingSchema();
  }

  async resolveFileAttachments(userInput) {
    const fileRefRegex = /@("[^"]+"|'[^']+'|[a-zA-Z0-9_./\\-]+)/g;
    const matches = [...userInput.matchAll(fileRefRegex)];
    if (!matches.length) {
      return { content: userInput, attachments: [] };
    }

    let config;
    try {
      config = await this.configLoader();
    } catch {
      config = null;
    }
    const maxBytes = config?.limits?.maxFileRefBytes ?? 102_400; // 100KB
    const maxRefs = config?.limits?.maxFileRefs ?? 5;

    let modifiedInput = userInput;
    const attachments = [];
    const uniqueMatches = Array.from(new Set(matches.map(m => m[1].replace(/^["']|["']$/g, ""))));

    for (let i = 0; i < Math.min(uniqueMatches.length, maxRefs); i++) {
      const relPath = uniqueMatches[i];
      const absPath = path.resolve(this.projectContextService.cwd, relPath);

      try {
        const fileStats = await this.fs.stat(absPath);
        if (!fileStats.isFile()) {
          continue;
        }

        let fileContent = "";
        if (fileStats.size > maxBytes) {
          let fileHandle;
          try {
            fileHandle = await this.fs.open(absPath, "r");
            const rawBuffer = Buffer.alloc(maxBytes);
            const { bytesRead } = await fileHandle.read(rawBuffer, 0, maxBytes, 0);
            fileContent = rawBuffer.toString("utf8", 0, bytesRead);
          } finally {
            if (fileHandle) {
              await fileHandle.close();
            }
          }
          this.renderer.terminalUI.warning(
            `File @${relPath} exceeds configured size limit (${Math.round(maxBytes/1024)}KB). Loaded first ${Math.round(maxBytes/1024)}KB.`
          );
          fileContent += `\n\n[Warning: Content truncated after ${Math.round(maxBytes/1024)}KB limit]`;
        } else {
          fileContent = await this.fs.readFile(absPath, "utf8");
        }

        attachments.push({
          path: relPath,
          size: fileStats.size,
          content: fileContent
        });

        const sizeLabel = fileStats.size > 1024 
          ? `${(fileStats.size / 1024).toFixed(1)}KB` 
          : `${fileStats.size}B`;
        this.renderer.terminalUI.success(`📎 Loaded file: ${relPath} (${sizeLabel})`);
      } catch (err) {
        this.renderer.terminalUI.warning(`Could not read file @${relPath}: ${err.message}`);
      }
    }

    if (uniqueMatches.length > maxRefs) {
      this.renderer.terminalUI.warning(
        `File reference limit reached. Loaded first ${maxRefs} files; remaining references ignored.`
      );
    }

    if (attachments.length > 0) {
      const attachmentMap = new Map();
      for (const att of attachments) {
        attachmentMap.set(att.path, att);
      }

      modifiedInput = modifiedInput.replace(fileRefRegex, (match, p1) => {
        const relPath = p1.replace(/^["']|["']$/g, "");
        const att = attachmentMap.get(relPath);
        if (att) {
          const ext = path.extname(att.path).slice(1);
          return `\n[Attachment: ${att.path}]\n\`\`\`${ext}\n${att.content}\n\`\`\`\n`;
        }
        return match;
      });
    }

    return { content: modifiedInput, attachments };
  }

  async autocompleteCompleter(line) {
    const match = line.match(/@([^@\n]*)$/);
    if (!match) {
      return [[], line];
    }

    const filePrefix = match[1];
    const cwd = this.projectContextService.cwd;
    
    let searchDir;
    let searchPrefix;

    if (filePrefix.includes("/") || filePrefix.includes("\\")) {
      const normalizedPath = filePrefix.replace(/\\/g, "/");
      const lastSlashIndex = normalizedPath.lastIndexOf("/");
      const dirPart = normalizedPath.slice(0, lastSlashIndex);
      searchPrefix = normalizedPath.slice(lastSlashIndex + 1);
      searchDir = path.resolve(cwd, dirPart);
    } else {
      searchDir = cwd;
      searchPrefix = filePrefix;
    }

    try {
      const entries = await this.fs.readdir(searchDir, { withFileTypes: true });
      const hits = entries
        .filter((entry) => {
          if (entry.name.startsWith(".") && !searchPrefix.startsWith(".")) {
            return false;
          }
          return entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase());
        })
        .map((entry) => {
          let relativeDir = "";
          if (filePrefix.includes("/") || filePrefix.includes("\\")) {
            const normalizedPath = filePrefix.replace(/\\/g, "/");
            const lastSlashIndex = normalizedPath.lastIndexOf("/");
            relativeDir = filePrefix.slice(0, lastSlashIndex + 1);
          }
          const suffix = entry.isDirectory() ? "/" : "";
          return `@${relativeDir}${entry.name}${suffix}`;
        });

      return [hits, `@${filePrefix}`];
    } catch {
      return [[], `@${filePrefix}`];
    }
  }

  async #readUserInput(readlineInterface, createAbortController) {
    const controller = createAbortController();

    try {
      return await readlineInterface.question(this.renderer.showUserPrompt(), {
        signal: controller.signal
      });
    } catch (error) {
      if (error?.code === "ERR_USE_AFTER_CLOSE") {
        return null;
      }

      if (isAbortLikeError(error)) {
        return null;
      }

      throw error;
    }
  }

  #isExitCommand(input) {
    const normalizedInput = input.toLowerCase();
    return normalizedInput === "/exit" || normalizedInput === "exit" || normalizedInput === "quit";
  }

  async #persistSession(sessionId) {
    const session = this.conversationStore.getSession(sessionId);
    try {
      await this.historyStore.saveSession(session);
    } catch (error) {
      this.#disableHistoryPersistence(error);
    }
  }

  async #loadSessionFromHistory(sessionId) {
    try {
      return await this.historyStore.loadSession(sessionId);
    } catch (error) {
      this.#disableHistoryPersistence(error);
      return null;
    }
  }

  #disableHistoryPersistence(error) {
    if (this.historyPersistenceDisabled) {
      return;
    }

    this.historyPersistenceDisabled = true;
    const message =
      error instanceof Error ? error.message : "History persistence is unavailable in this environment.";
    this.renderer.showWarning(`History persistence disabled: ${message}`);
  }
}
