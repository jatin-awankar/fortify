import { appMetadata } from "../config/app-metadata.js";

export function createChatCommand(commandService) {
  return {
    name: "chat",
    description: "Start an interactive assistant chat session.",
    configure(command) {
      command
        .summary("Open assistant chat")
        .description(
          "Start an interactive chat mode for ongoing development assistance."
        )
        .option("-m, --mode <mode>", "Chat mode profile", "default")
        .option("-r, --resume [id]", "Resume the most recent session or a specific session by id")
        .option("--session <id>", "Resume an existing session by id")
        .option("-p, --provider <provider>", "Override active AI provider (openai, anthropic, gemini, ollama)")
        .option("--model <model>", "Override active model name")
        .addHelpText(
          "after",
          `\nExample:\n  ${appMetadata.cliName} chat --resume\n  ${appMetadata.cliName} chat --provider gemini --model gemini-1.5-pro`
        )
        .action(async (options) => {
          const resumeId = options.resume === true ? "latest" : (options.resume || options.session || "");
          await commandService.chat({
            mode: options.mode,
            sessionId: resumeId,
            provider: options.provider,
            model: options.model
          });
        });
    }
  };
}
