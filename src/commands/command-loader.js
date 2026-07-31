import { createAuthCommand } from "./auth-command.js";
import { createChatCommand } from "./chat-command.js";
import { createCommitCommand } from "./commit-command.js";
import { createConfigCommand } from "./config-command.js";
import { createExplainCommand } from "./explain-command.js";
import { createHistoryCommand } from "./history-command.js";
import { createInitCommand } from "./init-command.js";
import { createSummarizeCommand } from "./summarize-command.js";
import { CommandService } from "../services/command-service.js";

export function getCommandDefinitions() {
  const commandService = new CommandService();

  return [
    createAuthCommand(commandService),
    createInitCommand(commandService),
    createConfigCommand(commandService),
    createExplainCommand(commandService),
    createCommitCommand(commandService),
    createSummarizeCommand(commandService),
    createChatCommand(commandService),
    createHistoryCommand(commandService)
  ];
}
