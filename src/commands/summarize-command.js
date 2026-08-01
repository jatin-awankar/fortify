import { appMetadata } from "../config/app-metadata.js";

export function createSummarizeCommand(commandService) {
  return {
    name: "summarize",
    description: "Summarize code, diffs, or project activity.",
    configure(command) {
      command
        .summary("Summarize development context")
        .description(
          "Produce concise summaries from files, diffs, logs, or recent project activity."
        )
        .argument("<path>", "File or folder path to summarize")
        .option("-f, --format <format>", "Summary format", "bullet")
        .option("-p, --provider <provider>", "Override active AI provider (openai, anthropic, gemini, ollama)")
        .option("--model <model>", "Override active model name")
        .addHelpText(
          "after",
          `\nExample:\n  ${appMetadata.cliName} summarize src --format bullet`
        )
        .action(async (targetPath, options) => {
          await commandService.summarize({
            source: targetPath,
            format: options.format,
            provider: options.provider,
            model: options.model
          });
        });
    }
  };
}
