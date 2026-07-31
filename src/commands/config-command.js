import { appMetadata } from "../config/app-metadata.js";

export function createConfigCommand(commandService) {
  return {
    name: "config",
    description: "Inspect and update local Fortify configuration.",
    configure(command) {
      command
        .summary("Manage local config")
        .description("Inspect, update, and validate local Fortify configuration.")
        .addHelpText(
          "after",
          `\nExamples:\n  ${appMetadata.cliName} config list\n  ${appMetadata.cliName} config get modelPreferences.defaultModel\n  ${appMetadata.cliName} config set modelPreferences.defaultModel gpt-5.1\n  ${appMetadata.cliName} config validate`,
        );

      command
        .command("list")
        .description("List local config with secrets redacted")
        .action(async () => {
          await commandService.config({ action: "list" });
        });

      command
        .command("get")
        .description("Read a config value by dotted key")
        .argument("<key>", "Dotted config key")
        .action(async (key) => {
          await commandService.config({ action: "get", key });
        });

      command
        .command("set")
        .description("Set a config value by dotted key")
        .argument("<key>", "Dotted config key")
        .argument("<value>", "String, boolean, null, JSON array, or JSON object")
        .action(async (key, value) => {
          await commandService.config({ action: "set", key, value });
        });

      command
        .command("validate")
        .description("Validate local config schema")
        .action(async () => {
          await commandService.config({ action: "validate" });
        });
    },
  };
}
