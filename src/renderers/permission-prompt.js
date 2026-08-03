import { createAnsiStyle } from "./ansi-style.js";
import { renderBox } from "./ansi-box.js";

/**
 * Permission response values.
 */
export const PERMISSION_RESPONSE = {
  ALLOW: "allow",
  DENY: "deny",
  ALLOW_ALL: "allow_all",
  EXPLAIN: "explain",
};

/**
 * Interactive permission prompts that pause execution for user approval.
 *
 * Renders a styled permission request box and waits for single-keypress input.
 *
 * Visual:
 * ```
 *   ╭─ Permission Request ──────────────────────────────╮
 *   │ 📝 Fortify wants to edit src/services/auth.js      │
 *   │                                                     │
 *   │ Changes: +12 -3 lines                               │
 *   │                                                     │
 *   │  [Y] Allow  [n] Deny  [a] Allow all  [?] Explain   │
 *   ╰─────────────────────────────────────────────────────╯
 * ```
 */
export class PermissionPrompt {
  #sessionAllowAll = new Set();

  constructor({
    stdin = process.stdin,
    stdout = process.stdout,
    env = process.env,
    autoApprove = false,
  } = {}) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.isTTY = Boolean(stdin && stdin.isTTY && stdout && stdout.isTTY);
    this.chalk = createAnsiStyle({ env });
    this.autoApprove = autoApprove;
  }

  /**
   * Request permission for a tool action.
   *
   * @param {object} options
   * @param {string} options.toolType - Tool type key (e.g., "write_file")
   * @param {string} options.description - What the tool wants to do
   * @param {string} [options.detail] - Additional detail (e.g., "+12 -3 lines")
   * @param {string} [options.icon] - Icon to display (default: based on toolType)
   * @param {boolean} [options.defaultAllow] - Default response if user presses Enter
   * @returns {Promise<string>} PERMISSION_RESPONSE value
   */
  async requestPermission({
    toolType,
    description,
    detail = "",
    icon = "",
    defaultAllow = false,
  }) {
    // Auto-approve mode (non-interactive / configured)
    if (this.autoApprove) {
      return PERMISSION_RESPONSE.ALLOW;
    }

    // Session-level allow-all for this tool type
    if (this.#sessionAllowAll.has(toolType)) {
      return PERMISSION_RESPONSE.ALLOW;
    }

    // Non-TTY: use default
    if (!this.isTTY) {
      return defaultAllow ? PERMISSION_RESPONSE.ALLOW : PERMISSION_RESPONSE.DENY;
    }

    // Render the permission prompt
    this.#renderPromptBox({ toolType, description, detail, icon });

    // Wait for single keypress
    const response = await this.#readSingleKey(defaultAllow);

    // Handle "allow all" — remember for this session
    if (response === PERMISSION_RESPONSE.ALLOW_ALL) {
      this.#sessionAllowAll.add(toolType);
    }

    return response;
  }

  /**
   * Render a compact inline permission prompt (no box, lighter weight).
   *
   * @param {object} options
   * @param {string} options.description - What needs approval
   * @param {boolean} [options.defaultAllow]
   * @returns {Promise<boolean>} true = allowed, false = denied
   */
  async confirmAction({ description, defaultAllow = false }) {
    if (this.autoApprove) return true;

    if (!this.isTTY) return defaultAllow;

    const promptSuffix = defaultAllow ? "[Y/n]" : "[y/N]";
    this.stdout.write(
      `\n  ${this.chalk.yellow("?")} ${description} ${this.chalk.dim(promptSuffix)} `
    );

    return new Promise((resolve) => {
      const onData = (data) => {
        const input = data.toString().trim().toLowerCase();
        this.stdin.removeListener("data", onData);
        if (typeof this.stdin.setRawMode === "function") {
          this.stdin.setRawMode(false);
        }
        this.stdout.write("\n");

        if (input === "y" || input === "yes") {
          resolve(true);
        } else if (input === "n" || input === "no") {
          resolve(false);
        } else {
          resolve(defaultAllow);
        }
      };

      if (typeof this.stdin.setRawMode === "function") {
        this.stdin.setRawMode(true);
      }
      this.stdin.resume();
      this.stdin.once("data", onData);
    });
  }

  /**
   * Check if a tool type has been "allow all"-ed for this session.
   * @param {string} toolType
   * @returns {boolean}
   */
  isAllowedAll(toolType) {
    return this.#sessionAllowAll.has(toolType);
  }

  /**
   * Reset all session-level allow-all grants.
   */
  resetAllowAll() {
    this.#sessionAllowAll.clear();
  }

  #renderPromptBox({ toolType, description, detail, icon }) {
    const toolIcons = {
      write_file: "📝",
      edit_file: "📝",
      execute_command: "⚡",
      read_file: "📄",
      search_files: "🔍",
    };

    const displayIcon = icon || toolIcons[toolType] || "🔐";

    const contentLines = [
      `${displayIcon} ${description}`,
    ];

    if (detail) {
      contentLines.push("");
      contentLines.push(detail);
    }

    contentLines.push("");

    const options = [
      `${this.chalk.green("[Y]")} Allow`,
      `${this.chalk.red("[n]")} Deny`,
      `${this.chalk.cyan("[a]")} Allow all`,
      `${this.chalk.dim("[?]")} Explain`,
    ];
    contentLines.push(` ${options.join("  ")}`);

    const box = renderBox({
      title: "Permission Request",
      content: contentLines,
      borderStyle: "rounded",
      margin: 2,
      minWidth: 50,
      chalk: this.chalk,
    });

    this.stdout.write(`\n${box}\n`);
  }

  /**
   * Read a single keypress in raw mode.
   * @param {boolean} defaultAllow
   * @returns {Promise<string>} PERMISSION_RESPONSE value
   */
  #readSingleKey(defaultAllow) {
    return new Promise((resolve) => {
      const prompt = `  ${this.chalk.dim("Your choice:")} `;
      this.stdout.write(prompt);

      const onData = (data) => {
        const key = data.toString().trim().toLowerCase();
        this.stdin.removeListener("data", onData);
        if (typeof this.stdin.setRawMode === "function") {
          this.stdin.setRawMode(false);
        }
        this.stdin.pause();

        let response;
        let label;

        switch (key) {
          case "y":
          case "":
            response = defaultAllow ? PERMISSION_RESPONSE.ALLOW : (key === "y" ? PERMISSION_RESPONSE.ALLOW : PERMISSION_RESPONSE.DENY);
            if (key === "y") response = PERMISSION_RESPONSE.ALLOW;
            if (key === "" && defaultAllow) response = PERMISSION_RESPONSE.ALLOW;
            if (key === "" && !defaultAllow) response = PERMISSION_RESPONSE.DENY;
            label = response === PERMISSION_RESPONSE.ALLOW ? this.chalk.green("✓ Allowed") : this.chalk.red("✖ Denied");
            break;
          case "n":
            response = PERMISSION_RESPONSE.DENY;
            label = this.chalk.red("✖ Denied");
            break;
          case "a":
            response = PERMISSION_RESPONSE.ALLOW_ALL;
            label = this.chalk.green("✓ Allowed all (this session)");
            break;
          case "?":
            response = PERMISSION_RESPONSE.EXPLAIN;
            label = this.chalk.cyan("ℹ Explain");
            break;
          default:
            response = defaultAllow ? PERMISSION_RESPONSE.ALLOW : PERMISSION_RESPONSE.DENY;
            label = response === PERMISSION_RESPONSE.ALLOW ? this.chalk.green("✓ Allowed") : this.chalk.red("✖ Denied");
        }

        this.stdout.write(`${label}\n`);
        resolve(response);
      };

      if (typeof this.stdin.setRawMode === "function") {
        this.stdin.setRawMode(true);
      }
      this.stdin.resume();
      this.stdin.once("data", onData);
    });
  }
}

/**
 * Create a PermissionPrompt instance.
 * @param {object} [options]
 * @returns {PermissionPrompt}
 */
export function createPermissionPrompt(options) {
  return new PermissionPrompt(options);
}
