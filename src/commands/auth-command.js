import { appMetadata } from "../config/app-metadata.js";

export function createAuthCommand(commandService) {
  return {
    name: "auth",
    description: "Configure local AI provider authentication credentials.",
    configure(command) {
      command
        .summary("Configure AI provider credentials locally")
        .description(
          `Configure API keys or local endpoint credentials for OpenAI, Anthropic, Google Gemini, or Ollama.`
        )
        .option("-p, --provider <provider>", "Specific provider to configure (openai, anthropic, gemini, ollama)")
        .addHelpText(
          "after",
          `\nExample:\n  ${appMetadata.cliName} auth\n  ${appMetadata.cliName} auth --provider gemini`
        )
        .action(async (options) => {
          await commandService.auth({ provider: options.provider });
        });
    }
  };
}
