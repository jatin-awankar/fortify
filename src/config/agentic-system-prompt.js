/**
 * Agentic System Prompt Builder — production-grade prompt assembly.
 *
 * Composes a comprehensive system prompt from multiple context sources:
 *   [Identity] → [Working Directory] → [Project Context] → [Project Memory]
 *   → [Repository Map] → [Custom Rules] → [Agentic Mode Guidelines] → [Response Format]
 *
 * Features:
 * - Priority-based token budget enforcement
 * - Graceful degradation (missing sections handled cleanly)
 * - Configurable token limits per section
 *
 * Token budget priorities (highest = last to truncate):
 *   1. Identity + Tools (always included, never truncated)
 *   2. Memory (high priority — user/agent knowledge)
 *   3. Custom Rules (medium priority)
 *   4. Repo Map (truncated first — regenerable via tool calls)
 *
 * Zero external dependencies.
 */

/**
 * Default token budgets for each prompt section.
 */
const DEFAULT_TOKEN_BUDGETS = {
  /** Total combined token budget for the system prompt context */
  total: 4000,
  /** Budget reserved for the identity block (always included) */
  identity: 600,
  /** Budget for the project context block (name, stack, git) */
  projectContext: 300,
  /** Budget for the repository map */
  repoMap: 1500,
  /** Budget for project memory */
  memory: 800,
  /** Budget for custom rules */
  customRules: 400,
  /** Budget for tool summary and guidelines */
  toolGuidelines: 400,
};

/**
 * Length of the truncation marker appended when content is trimmed.
 */
const TRUNCATION_MARKER = "\n[...truncated]";

/**
 * Estimate token count from text (~4 chars per token).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a token budget.
 * Accounts for the truncation marker in the budget so output never exceeds maxTokens.
 *
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string}
 */
function truncateToTokens(text, maxTokens) {
  if (!text) return "";
  if (maxTokens <= 0) return "";
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  // Subtract marker length so total output stays within budget
  const sliceEnd = Math.max(0, maxChars - TRUNCATION_MARKER.length);
  return text.slice(0, sliceEnd) + TRUNCATION_MARKER;
}

/**
 * Build the Fortify identity block — always included in the prompt.
 *
 * @returns {string}
 */
function buildIdentityBlock() {
  return `You are Fortify, an AI-powered terminal coding assistant built for developers who live in the command line.

You help developers by reading and understanding their codebase, writing and editing code, running commands, and explaining complex systems — all from the terminal.

Core principles:
- Respond directly and concisely in clean markdown. No internal monologues or reasoning preambles.
- Read before you write. Understand existing code before modifying it.
- Prefer targeted edits over full rewrites. Use edit_file for surgical changes.
- Respect existing code style, naming conventions, and project patterns.
- Verify your work. After changes, read the file or run tests to confirm correctness.
- Work incrementally. Small, testable changes over large sweeping modifications.
- Handle errors gracefully. If something fails, analyze and try an alternative.`;
}

/**
 * Build the tool guidelines block.
 *
 * @param {string} toolSummary - Human-readable tool summary from ToolRegistry
 * @returns {string}
 */
function buildToolGuidelinesBlock(toolSummary) {
  return `[Agentic Mode]
You have access to file system and command execution tools. Use them proactively to explore the codebase, make changes, and verify your work.

## File Operations
- read_file: Read file contents. Always read before editing.
- write_file: Create new files or fully overwrite existing ones.
- edit_file: Apply targeted search-and-replace edits to existing files. Provide exact text to search for.
- search_files: Search for text patterns across the workspace. Supports regex.
- list_directory: List files and directories. Use to explore project structure.

## Command Execution
- execute_command: Run shell commands. All commands require user permission.
- Commands run with a 30-second timeout and 50KB output limit.
- Use for: running tests, installing packages, building, linting, git operations.
- Dangerous commands (rm -rf, format, shutdown) are blocked automatically.

${toolSummary}`;
}

/**
 * Build the complete agentic system prompt.
 *
 * Assembles all context sources into a single prompt with token budget enforcement.
 *
 * @param {object} options
 * @param {string} options.basePrompt - Project context ONLY (name, stack, git info) from
 *   ProjectContextService.formatSystemPromptContext(). Do NOT include identity/persona text
 *   here — the identity block is added automatically by this builder.
 * @param {string} options.toolSummary - Human-readable tool summary from ToolRegistry
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.repoMap] - Formatted repository map from RepoMapService
 * @param {string} [options.memory] - Formatted memory content from MemoryService
 * @param {string} [options.customRules] - Custom rules from .fortify/rules.md
 * @param {object} [options.tokenBudgets] - Override default token budgets
 * @returns {string} Complete system prompt
 */
export function buildAgenticSystemPrompt({
  basePrompt,
  toolSummary,
  cwd,
  repoMap,
  memory,
  customRules,
  tokenBudgets,
} = {}) {
  const budgets = { ...DEFAULT_TOKEN_BUDGETS, ...tokenBudgets };

  const sections = [];

  // [Identity] — always included
  sections.push(buildIdentityBlock());

  // [Working Directory]
  if (cwd) {
    sections.push(`Working Directory: ${cwd}`);
  }

  // [Project Context] — from ProjectContextService (project metadata only, not identity)
  if (basePrompt) {
    const truncated = truncateToTokens(basePrompt, budgets.projectContext);
    sections.push(truncated);
  }

  // Token accounting for priority-based truncation
  const fixedTokens = estimateTokens(sections.join("\n\n"));
  const toolBlock = buildToolGuidelinesBlock(toolSummary || "");
  const toolTokens = estimateTokens(toolBlock);
  // Response format is a fixed-size block (~20 tokens)
  const responseFormatBlock = `[Response Format]
- Respond in clean markdown.
- When showing code changes, describe what changed and why.
- After completing a task, summarize what was done.`;
  const responseTokens = estimateTokens(responseFormatBlock);
  const remainingBudget = Math.max(0, budgets.total - fixedTokens - toolTokens - responseTokens);

  // Allocate remaining budget by priority:
  //   memory (priority 1) → rules (priority 2) → repo-map (priority 3, truncated first)
  let memoryBlock = "";
  let rulesBlock = "";
  let repoMapBlock = "";
  let budgetLeft = remainingBudget;

  // Memory — highest priority for dynamic context
  if (memory && memory.trim()) {
    const memoryBudget = Math.min(budgets.memory, budgetLeft);
    memoryBlock = truncateToTokens(memory.trim(), memoryBudget);
    budgetLeft = Math.max(0, budgetLeft - estimateTokens(memoryBlock));
  }

  // Custom Rules — medium priority
  if (customRules && customRules.trim()) {
    const rulesBudget = Math.min(budgets.customRules, budgetLeft);
    rulesBlock = truncateToTokens(customRules.trim(), rulesBudget);
    budgetLeft = Math.max(0, budgetLeft - estimateTokens(rulesBlock));
  }

  // Repo Map — lowest priority (truncated first, regenerable via tools)
  if (repoMap && repoMap.trim()) {
    const mapBudget = Math.min(budgets.repoMap, budgetLeft);
    repoMapBlock = truncateToTokens(repoMap.trim(), mapBudget);
    budgetLeft = Math.max(0, budgetLeft - estimateTokens(repoMapBlock));
  }

  // Assemble dynamic sections — memory before repo-map (higher priority = earlier in prompt)
  if (memoryBlock) {
    sections.push(`[Project Memory]\n${memoryBlock}`);
  }

  if (repoMapBlock) {
    sections.push(repoMapBlock);
  }

  if (rulesBlock) {
    sections.push(`[Custom Rules]\n${rulesBlock}`);
  }

  // Tool guidelines — always included
  sections.push(toolBlock);

  // Response format — always included
  sections.push(responseFormatBlock);

  return sections.join("\n\n");
}

// Re-export for testing
export { DEFAULT_TOKEN_BUDGETS, estimateTokens, truncateToTokens, buildIdentityBlock, buildToolGuidelinesBlock };
