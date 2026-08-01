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
        promptText: "OpenAI API key: "
      });
    }

    if (targetProvider === "anthropic" || targetProvider === "claude") {
      return this.#setupApiKey({
        providerName: "Anthropic Claude",
        providerKey: "anthropic",
        promptText: "Anthropic API key: "
      });
    }

    if (targetProvider === "gemini" || targetProvider === "google") {
      return this.#setupApiKey({
        providerName: "Google Gemini",
        providerKey: "gemini",
        promptText: "Google Gemini API key: "
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

  async #setupApiKey({ providerName, providerKey, promptText }) {
    this.terminalUI.info(`Configuring credentials for ${providerName}. Input is hidden.`);

    try {
      const apiKey = (await this.secretPrompt({
        prompt: promptText,
        stdin: this.terminalUI.stdin,
        stdout: this.terminalUI.stdout
      })).trim();

      if (!apiKey) {
        this.terminalUI.error("API key cannot be empty.");
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
      const endpoint = (await rl.question(this.terminalUI.chalk.cyan("Ollama Base URL [http://localhost:11434]: "))).trim() || "http://localhost:11434";

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
