import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import { appMetadata } from "./config/app-metadata.js";
import { setRuntimeOptions } from "./utils/runtime-options.js";

export async function runCli(argv = process.argv) {
  const program = new Command();

  program
    .name(appMetadata.cliName)
    .description(appMetadata.description)
    .version(appMetadata.version)
    .option("--json", "Emit machine-readable JSON where supported")
    .option("--verbose", "Show additional diagnostic output")
    .option("--quiet", "Reduce nonessential terminal output");

  program.hook("preAction", (rootCommand) => {
    setRuntimeOptions(rootCommand.opts());
  });

  registerCommands(program);

  await program.parseAsync(argv);
}
