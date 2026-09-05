import { InMemoryConversationStore } from "../storage/in-memory-conversation-store.js";
import { ProviderFactory } from "./provider-factory.js";
import { ProjectContextService } from "./project-context-service.js";
import { ToolRegistry } from "./tool-registry.js";
import { ToolExecutor } from "./tool-executor.js";
import { AgenticLoop } from "./agentic-loop.js";
import { registerAllHandlers } from "../tools/index.js";
import { createFortifyIgnore } from "../config/fortifyignore.js";
import { createCommandAllowlist } from "../config/command-allowlist.js";
import { buildAgenticSystemPrompt } from "../config/agentic-system-prompt.js";
import { RepoMapService } from "./repo-map-service.js";
import { MemoryService } from "./memory-service.js";
import { loadConfig } from "../config/index.js";

/**
 * Headless chat service — non-interactive agentic execution.
 *
 * Designed for `fortify run` (CI/CD, scripts, automation):
 * - No readline, no TUI, no interactive prompts
 * - Auto-approves all tool operations
 * - Returns structured results
 * - Supports timeout and token budget
 *
 * @example
 * const service = new HeadlessChatService();
 * const result = await service.run({
 *   prompt: "fix the login bug",
 *   provider: "anthropic",
 *   timeout: 120,
 * });
 * console.log(result.text);
 * process.exit(result.exitCode);
 */
export class HeadlessChatService {
  constructor({
    providerFactory,
    projectContextService,
    configLoader = loadConfig,
    toolRegistry,
    toolExecutor,
    stdout = process.stdout,
    env = process.env,
  } = {}) {
    this.providerFactory = providerFactory || new ProviderFactory();
    this.projectContextService = projectContextService || new ProjectContextService();
    this.configLoader = configLoader;
    this.stdout = stdout;
    this.env = env;

    // Tool infrastructure — auto-approve mode
    this.toolRegistry = toolRegistry || new ToolRegistry();
    this.toolExecutor = toolExecutor || new ToolExecutor({
      toolRegistry: this.toolRegistry,
      permissionPrompt: {
        // Auto-approve all in headless mode
        requestPermission: async () => "allow",
      },
      stdout,
      env,
    });

    registerAllHandlers(this.toolExecutor);
    this.commandAllowlist = createCommandAllowlist();
  }

  /**
   * Run a single headless agentic task.
   *
   * @param {object} options
   * @param {string} options.prompt - The task/prompt to execute
   * @param {string} [options.provider] - LLM provider name
   * @param {string} [options.model] - Model name
   * @param {number} [options.maxIterations=25] - Max agentic loop iterations
   * @param {number} [options.timeout=0] - Wall-clock timeout in seconds (0 = unlimited)
   * @param {number} [options.tokenBudget=0] - Approximate token budget (0 = unlimited)
   * @param {AbortSignal} [options.signal] - Abort signal
   * @returns {Promise<HeadlessResult>}
   *
   * @typedef {{ ok: boolean, text: string, toolResults: object[], iterations: number, tokensUsed: number, exitCode: number, error?: string }} HeadlessResult
   */
  async run({
    prompt,
    provider = "",
    model = "",
    maxIterations = 25,
    timeout = 0,
    tokenBudget = 0,
    signal,
  } = {}) {
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return {
        ok: false,
        text: "",
        toolResults: [],
        iterations: 0,
        tokensUsed: 0,
        exitCode: 1,
        error: "No prompt provided. Usage: fortify run \"<prompt>\"",
      };
    }

    try {
      // 1. Build system prompt with full context
      const contextPrompt = await this.#buildContextPrompt();

      // 2. Create conversation
      const conversationStore = new InMemoryConversationStore();
      const sessionId = `headless_${Date.now()}`;
      conversationStore.getOrCreateSession(sessionId);
      conversationStore.addMessage(sessionId, {
        role: "user",
        content: prompt.trim(),
      });

      // 3. Configure agentic loop
      const agenticLoop = new AgenticLoop({
        toolRegistry: this.toolRegistry,
        toolExecutor: this.toolExecutor,
        maxIterations,
        tokenBudget,
        timeoutMs: timeout > 0 ? timeout * 1000 : 0,
      });

      // 4. Get provider
      const providerService = await this.providerFactory.getProvider(provider);

      // 5. Build messages
      const messages = conversationStore.toResponseInput(sessionId);
      messages.unshift({ role: "system", content: contextPrompt });

      const cwd = this.projectContextService.cwd;

      // Load ignore patterns
      let fortifyIgnore = null;
      try {
        fortifyIgnore = await createFortifyIgnore({ cwd });
      } catch {
        // Continue without
      }

      // 6. Run the agentic loop
      const result = await agenticLoop.run({
        messages,
        sendToLLM: async (msgs, tools) => {
          const response = await providerService.createResponse({
            input: msgs,
            model: model && model !== "default" ? model : undefined,
            tools: tools && tools.length > 0 ? tools : undefined,
            signal,
          });
          return AgenticLoop.parseResponse(response);
        },
        context: {
          sessionId,
          cwd,
          commandAllowlist: this.commandAllowlist,
          fortifyIgnore,
          autoApprove: true, // Headless = always auto-approve
        },
        signal,
      });

      return {
        ok: !result.aborted,
        text: result.text || "",
        toolResults: result.toolResults || [],
        iterations: result.iterations || 0,
        tokensUsed: result.tokensUsed || 0,
        exitCode: result.aborted ? 1 : 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        text: "",
        toolResults: [],
        iterations: 0,
        tokensUsed: 0,
        exitCode: 1,
        error: errorMsg,
      };
    }
  }

  /**
   * Build the full agentic system prompt with context.
   * @private
   * @returns {Promise<string>}
   */
  async #buildContextPrompt() {
    const contextSummary = await this.projectContextService.getProjectContextSummary();
    const basePrompt = this.projectContextService.formatSystemPromptContext(contextSummary);
    const cwd = this.projectContextService.cwd;

    // Generate repo map
    let repoMapText = "";
    try {
      const repoMapService = new RepoMapService({
        gitService: this.projectContextService.gitService,
      });
      const repoMap = await repoMapService.generateRepoMap({ cwd, includeSymbols: true });
      repoMapText = repoMapService.formatForPrompt(repoMap);
    } catch {
      // Non-critical
    }

    // Load persistent memory
    let memoryText = "";
    try {
      const memoryService = new MemoryService();
      const rawMemory = await memoryService.loadMemory(cwd);
      if (rawMemory) {
        memoryText = memoryService.formatForPrompt(rawMemory);
      }
    } catch {
      // Non-critical
    }

    return buildAgenticSystemPrompt({
      basePrompt,
      toolSummary: this.toolRegistry.toSystemPromptSummary(),
      cwd,
      repoMap: repoMapText,
      memory: memoryText,
    });
  }
}
