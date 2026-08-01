import { createInterface } from "node:readline/promises";
import { getConfigPath, updateConfig } from "../config/index.js";
import { createTerminalUI } from "../renderers/index.js";
import { promptSecretInput } from "../utils/prompt-secret.js";

export class AuthService {
  constructor({
    configPathResolver = getConfigPath,
    configUpdater = updateConfig,
    terminalUI = createTerminalUI(),
    secretPrompt = promptSecretInput
  } = {}) {
    this.configPathResolver = configPathResolver;
    this.configUpdater = configUpdater;
    this.terminalUI = terminalUI;
    this.secretPrompt = secretPrompt;
  }

  async authenticateOpenAIKey() {
    return this.authenticateProviderCredentials({ provider: "openai" });
  }

  async authenticateProviderCredentials({ provider = "" } = {}) {
    if (!this.terminalUI.capabilities.isInteractive) {
      this.terminalUI.error("`auth` requires an interactive terminal.");
      return false;
    }

    this.terminalUI.divider("Authentication & Provider Setup");

    let targetProvider = (provider || "").toLowerCase().trim();

    if (!targetProvider) {
      targetProvider = await this.#promptProviderSelection();
    }

    if (!targetProvider) {
      this.terminalUI.error("Invalid provider selected.");
      return false;
    }

    if (targetProvider === "openai") {
      return this.#setupApiKey({
        providerName: "OpenAI",
        providerKey: "openai",
        promptText: "OpenAI API key: ",
        helpUrl: "https://platform.openai.com/api-keys"
      });
    }

    if (targetProvider === "anthropic" || targetProvider === "claude") {
      return this.#setupApiKey({
        providerName: "Anthropic Claude",
        providerKey: "anthropic",
        promptText: "Anthropic API key: ",
        helpUrl: "https://console.anthropic.com/settings/keys"
      });
    }

    if (targetProvider === "gemini" || targetProvider === "google") {
      return this.#setupApiKey({
        providerName: "Google Gemini",
        providerKey: "gemini",
        promptText: "Google Gemini API key: ",
        helpUrl: "https://aistudio.google.com/app/apikey",
        helpNote: "Free tier token quotas available"
      });
    }

    if (targetProvider === "ollama" || targetProvider === "local") {
      return this.#setupOllamaEndpoint();
    }

    this.terminalUI.error(`Unknown provider '${targetProvider}'. Supported: openai, anthropic, gemini, ollama.`);
    return false;
  }

  async #promptProviderSelection() {
    this.terminalUI.info("Select active AI Provider to configure:");
    this.terminalUI.stdout.write("  1) OpenAI (GPT-5.4, GPT-5.3)\n");
    this.terminalUI.stdout.write("  2) Anthropic (Claude 3.5 Sonnet)\n");
    this.terminalUI.stdout.write("  3) Google Gemini (Gemini 2.0 Flash / 1.5 Pro - Free tier available)\n");
    this.terminalUI.stdout.write("  4) Ollama (Local LLM)\n\n");

    const rl = createInterface({
      input: this.terminalUI.stdin,
      output: this.terminalUI.stdout
    });

    try {
      const choice = (await rl.question(this.terminalUI.chalk.cyan("Choice [1-4]: "))).trim();
      if (choice === "1" || choice.toLowerCase() === "openai") return "openai";
      if (choice === "2" || choice.toLowerCase() === "anthropic") return "anthropic";
      if (choice === "3" || choice.toLowerCase() === "gemini") return "gemini";
      if (choice === "4" || choice.toLowerCase() === "ollama") return "ollama";
      return "";
    } finally {
      rl.close();
    }
  }

  validateKeyFormat(providerKey, apiKey) {
    if (typeof apiKey !== "string" || !apiKey.trim()) {
      return { valid: false, reason: "API key cannot be empty." };
    }

    const key = apiKey.trim();

    if (providerKey === "openai") {
      if (!key.startsWith("sk-") || key.length < 20) {
        return { valid: false, reason: "Invalid OpenAI API key format. Keys must start with 'sk-' and be at least 20 characters long." };
      }
    }

    if (providerKey === "anthropic") {
      if (!key.startsWith("sk-ant-") || key.length < 20) {
        return { valid: false, reason: "Invalid Anthropic API key format. Keys must start with 'sk-ant-' and be at least 20 characters long." };
      }
    }

    if (providerKey === "gemini") {
      if (key.length < 15 || /\s/.test(key)) {
        return { valid: false, reason: "Invalid Google Gemini API key format. Keys must be at least 15 characters long without spaces." };
      }
    }

    return { valid: true };
  }

  async #setupApiKey({ providerName, providerKey, promptText, helpUrl = "", helpNote = "" }) {
    this.terminalUI.info(`Configuring credentials for ${providerName}. Input is hidden.`);
    if (helpUrl) {
      this.terminalUI.stdout.write(`🔗 Get your ${providerName} API key here: ${this.terminalUI.chalk.cyan(helpUrl)}${helpNote ? ` (${helpNote})` : ""}\n\n`);
    }

    try {
      const apiKey = (await this.secretPrompt({
        prompt: promptText,
        stdin: this.terminalUI.stdin,
        stdout: this.terminalUI.stdout
      })).trim();

      const validation = this.validateKeyFormat(providerKey, apiKey);
      if (!validation.valid) {
        this.terminalUI.error(validation.reason);
        return false;
      }

      await this.configUpdater({
        provider: providerKey,
        apiKeys: {
          [providerKey]: apiKey
        }
      });

      const configPath = this.configPathResolver();
      this.terminalUI.success(`${providerName} API key saved and active provider set to '${providerKey}' in ${configPath}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      this.terminalUI.error(message);
      return false;
    }
  }

  async #setupOllamaEndpoint() {
    this.terminalUI.info("Configuring Local Ollama Endpoint.");

    const rl = createInterface({
      input: this.terminalUI.stdin,
      output: this.terminalUI.stdout
    });

    try {
      let rawEndpoint = (await rl.question(this.terminalUI.chalk.cyan("Ollama Base URL [http://localhost:11434]: "))).trim() || "http://localhost:11434";
      if (!rawEndpoint.startsWith("http://") && !rawEndpoint.startsWith("https://")) {
        rawEndpoint = `http://${rawEndpoint}`;
      }
      const endpoint = rawEndpoint.replace(/\/+$/, "");

      await this.configUpdater({
        provider: "ollama",
        endpoints: {
          ollama: endpoint
        }
      });

      const configPath = this.configPathResolver();
      this.terminalUI.success(`Ollama endpoint (${endpoint}) saved and active provider set to 'ollama' in ${configPath}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ollama setup failed.";
      this.terminalUI.error(message);
      return false;
    } finally {
      rl.close();
    }
  }
}
