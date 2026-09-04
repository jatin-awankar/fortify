/**
 * Command allowlist — security layer for execute_command.
 *
 * Provides a safer execution model by:
 *  1. Allowing only known-safe command prefixes by default
 *  2. Blocking dangerous commands that should never run
 *  3. Warning about shell metacharacters that could enable injection
 *
 * Users can extend the allowlist via `.fortify/config.json`.
 */

/**
 * Default allowed command prefixes.
 * Commands starting with any of these are permitted (subject to user permission prompt).
 */
const DEFAULT_ALLOWED_PREFIXES = [
  // Node.js / JavaScript
  "node", "npm", "npx", "pnpm", "yarn", "bun", "deno",
  // TypeScript / Linting / Formatting
  "tsc", "eslint", "prettier", "biome",
  // Test runners
  "jest", "vitest", "mocha", "playwright", "cypress",
  // Git (read-only and safe operations)
  "git status", "git diff", "git log", "git branch", "git show",
  "git stash list", "git stash push", "git stash pop", "git stash drop",
  "git add", "git checkout", "git clean",
  "git remote", "git tag",
  // Python
  "python", "python3", "pip", "pip3", "pytest", "ruff", "mypy",
  // Rust
  "cargo", "rustc", "rustfmt", "clippy",
  // Go
  "go test", "go build", "go run", "go vet", "go fmt", "go mod",
  // General safe commands
  "cat", "head", "tail", "wc", "grep", "find", "ls", "dir",
  "echo", "pwd", "which", "where", "type", "whoami",
  "sort", "uniq", "diff", "less", "more",
  // Build tools
  "make", "cmake", "gradle", "mvn",
  // Docker (inspection only)
  "docker ps", "docker images", "docker logs",
];

/**
 * Commands that should NEVER be allowed, even with explicit user approval.
 * These match anywhere in the command string.
 */
const BLOCKED_PATTERNS = [
  // Destructive filesystem operations
  "rm -rf /",
  "rm -rf ~",
  "rm -rf *",
  "rmdir /s /q c:",
  // Disk formatting / raw write
  "format c:",
  "mkfs",
  "dd if=",
  "> /dev/sda",
  // System control
  "shutdown", "reboot", "halt", "poweroff",
  "init 0", "init 6",
  // Fork bomb
  ":(){ :|:& };:",
  // Permission escalation risks
  "chmod 777", "chmod -R 777",
  "chmod 000", "chmod -R 000",
  // Remote code execution via pipe
  "curl | sh", "curl | bash",
  "wget | sh", "wget | bash",
  "curl|sh", "curl|bash",
  "wget|sh", "wget|bash",
  // Registry / system config
  "reg delete", "reg add",
  // Environment destruction
  "del /f /s /q",
  "rd /s /q",
];

/**
 * Shell metacharacters that could enable command injection.
 */
const DANGEROUS_METACHARACTERS = [
  { char: ";", name: "semicolon (command chaining)" },
  { char: "&&", name: "double ampersand (conditional chaining)" },
  { char: "||", name: "double pipe (conditional chaining)" },
  { char: "`", name: "backtick (command substitution)" },
  { char: "$(", name: "dollar-paren (command substitution)" },
];

/**
 * Pipe operator — warned about but not blocked (common in legitimate use).
 */
const PIPE_CHAR = "|";

export class CommandAllowlist {
  #allowedPrefixes;
  #blockedPatterns;

  /**
   * @param {object} [options]
   * @param {string[]} [options.customAllowedPrefixes] - Additional allowed prefixes from user config
   * @param {string[]} [options.customBlockedPatterns] - Additional blocked patterns from user config
   */
  constructor({ customAllowedPrefixes = [], customBlockedPatterns = [] } = {}) {
    this.#allowedPrefixes = [
      ...DEFAULT_ALLOWED_PREFIXES,
      ...customAllowedPrefixes,
    ];
    this.#blockedPatterns = [
      ...BLOCKED_PATTERNS,
      ...customBlockedPatterns,
    ];
  }

  /**
   * Validate a command against the allowlist and blocklist.
   *
   * @param {string} command - Full command string to validate
   * @returns {{ allowed: boolean, reason?: string, warnings: string[] }}
   */
  validate(command) {
    if (!command || typeof command !== "string") {
      return {
        allowed: false,
        reason: "Command is empty or invalid.",
        warnings: [],
      };
    }

    const trimmed = command.trim();
    if (!trimmed) {
      return {
        allowed: false,
        reason: "Command is empty.",
        warnings: [],
      };
    }

    const lowerCommand = trimmed.toLowerCase();
    const warnings = [];

    // 1. Check blocked patterns FIRST (absolute deny)
    for (const blocked of this.#blockedPatterns) {
      if (lowerCommand.includes(blocked.toLowerCase())) {
        return {
          allowed: false,
          reason: `Command contains blocked pattern: "${blocked}". This command is never allowed for safety.`,
          warnings: [],
        };
      }
    }

    // 2. Check for dangerous metacharacters
    for (const meta of DANGEROUS_METACHARACTERS) {
      if (trimmed.includes(meta.char)) {
        return {
          allowed: false,
          reason: `Command contains ${meta.name} which could enable command injection. Split into separate commands instead.`,
          warnings: [],
        };
      }
    }

    // 3. Warn about pipe (allowed but flagged)
    if (trimmed.includes(PIPE_CHAR)) {
      warnings.push("Command uses pipe (|). Ensure the piped command is also safe.");
    }

    // 4. Check allowed prefixes
    const isAllowed = this.#allowedPrefixes.some((prefix) => {
      const lowerPrefix = prefix.toLowerCase();
      // Match exact prefix followed by space, end-of-string, or common separators
      return (
        lowerCommand === lowerPrefix ||
        lowerCommand.startsWith(lowerPrefix + " ") ||
        lowerCommand.startsWith(lowerPrefix + "\t")
      );
    });

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Command "${trimmed.split(/\s+/)[0]}" is not in the allowed command list. Add it to .fortify/config.json allowedCommands to permit it.`,
        warnings,
      };
    }

    return {
      allowed: true,
      warnings,
    };
  }

  /**
   * Get the list of allowed prefixes (for display in /tools).
   * @returns {string[]}
   */
  getAllowedPrefixes() {
    return [...this.#allowedPrefixes];
  }

  /**
   * Get the list of blocked patterns (for diagnostics).
   * @returns {string[]}
   */
  getBlockedPatterns() {
    return [...this.#blockedPatterns];
  }
}

/**
 * Create a CommandAllowlist instance.
 * @param {object} [options]
 * @returns {CommandAllowlist}
 */
export function createCommandAllowlist(options) {
  return new CommandAllowlist(options);
}

export { DEFAULT_ALLOWED_PREFIXES, BLOCKED_PATTERNS, DANGEROUS_METACHARACTERS };
