import { appMetadata } from "../config/app-metadata.js";

export function createExplainCommand(commandService) {
  return {
    name: "explain",
    description: "Explain code, errors, or terminal output.",
    configure(command) {
      command
        .summary("Explain technical context")
        .description(
          "Generate an explanation for code snippets, error messages, or command output."
        )
        .argument("<file-or-text>", "Stack trace file path or pasted error text")
        .option("-c, --context <text>", "Additional context to improve explanation")
        .option("-p, --provider <provider>", "Override active AI provider (openai, anthropic, gemini, ollama)")
        .option("--model <model>", "Override active model name")
        .addHelpText(
          "after",
          `\nExamples:\n  ${appMetadata.cliName} explain ./logs/error.log\n  ${appMetadata.cliName} explain \"TypeError: x is not a function\\n    at main (index.js:12:3)\"`
        )
        .action(async (targetInput, options) => {
          await commandService.explain({
            target: targetInput,
            context: options.context ?? "",
            provider: options.provider,
            model: options.model
          });
        });
    }
  };
}
