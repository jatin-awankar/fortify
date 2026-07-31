import { loadRuntimeConfig } from "../config/index.js";
import { OpenAIService } from "./openai/index.js";
import { AnthropicService } from "./anthropic/anthropic-service.js";
import { OllamaService } from "./ollama/ollama-service.js";

export class ProviderFactory {
  constructor({
    configLoader = loadRuntimeConfig,
    openAIService = new OpenAIService(),
    anthropicService = new AnthropicService(),
    ollamaService = new OllamaService()
  } = {}) {
    this.configLoader = configLoader;
    this.openAIService = openAIService;
    this.anthropicService = anthropicService;
    this.ollamaService = ollamaService;
  }

  async getProvider(explicitProvider) {
    const config = await this.configLoader();
    const providerName = (explicitProvider || config?.provider || "openai").toLowerCase();

    if (providerName === "anthropic" || providerName === "claude") {
      return this.anthropicService;
    }

    if (providerName === "ollama" || providerName === "local") {
      return this.ollamaService;
    }

    return this.openAIService;
  }
}
