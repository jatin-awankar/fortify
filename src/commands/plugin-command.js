import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { appMetadata } from "../config/app-metadata.js";
import { PluginService } from "../services/plugin-service.js";

export function createPluginCommand(commandService) {
  return {
    name: "plugin",
    description: "Manage workspace plugins, prompt shortcuts, and custom rules.",
    configure(command) {
      command
        .summary("Workspace plugin and shortcut management")
        .description(
          "Inspect, initialize, and manage project-level plugins, prompt shortcuts, and custom rule definitions."
        );

      command
        .command("list")
        .summary("List loaded workspace plugins and prompt shortcuts")
        .action(async () => {
          await commandService.listPlugins();
        });

      command
        .command("init")
        .summary("Initialize sample plugin shortcuts and rules file in .fortify/")
        .action(async () => {
          await commandService.initPluginTemplates();
        });
    }
  };
}
