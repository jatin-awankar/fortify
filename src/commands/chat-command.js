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
        .addHelpText(
          "after",
          `\nExample:\n  ${appMetadata.cliName} chat --resume\n  ${appMetadata.cliName} chat --session local-dev`
        )
        .action(async (options) => {
          const resumeId = options.resume === true ? "latest" : (options.resume || options.session || "");
          await commandService.chat({
            mode: options.mode,
            sessionId: resumeId
          });
        });
    }
  };
}
