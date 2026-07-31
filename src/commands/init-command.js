import { appMetadata } from "../config/app-metadata.js";

export function createInitCommand(commandService) {
  return {
    name: "init",
    description: "Initialize Fortify context in the current workspace.",
    configure(command) {
      command
        .summary("Initialize workspace context")
        .description(
          "Creates a local .fortify/project.json workspace config to store repository-scoped instructions and stack metadata."
        )
        .option("-n, --name <name>", "Workspace name override")
        .option("-s, --stack <stack>", "Workspace project stack override")
        .option("-y, --yes", "Skip interactive prompting and accept defaults")
        .addHelpText("after", `\nExample:\n  ${appMetadata.cliName} init`)
        .action(async (options) => {
          await commandService.init({
            name: options.name,
            stack: options.stack,
            yes: options.yes
          });
        });
    }
  };
}
