import { parseArgs } from "node:util";
import { appMetadata } from "../config/app-metadata.js";
import { CommandService } from "../services/command-service.js";

export function printHelpText(subcommand = "") {
  const name = appMetadata.cliName;
  const ver = appMetadata.version;

  if (subcommand === "commit") {
    console.log(`Usage: ${name} commit [options]

Prepare commit message drafts from staged changes and repository context.

Options:
  -s, --style <style>      Commit style convention (default: "conventional")
  --scope <scope>          Optional commit scope
  --dry-run                Generate and display a commit message without committing
  -i, --interactive        Edit commit message in your preferred editor before committing
  --validate               Enforce Conventional Commits specification format
  -y, --yes                Skip confirmation and commit automatically
  -p, --provider <name>    Override active AI provider (openai, anthropic, gemini, ollama)
  --model <name>           Override active model name
  -h, --help               display help for command
`);
    return;
  }

  if (subcommand === "config") {
    console.log(`Usage: ${name} config [command] [options]

Inspect, validate, and update local configuration settings.

Commands:
  list                     List all configuration options
  get <key>                Get a configuration option by key
  set <key> <value>        Set a configuration option by key
  validate                 Validate local configuration settings
  -h, --help               display help for command
`);
    return;
  }

  console.log(`Usage: ${name} [options] [command]

${appMetadata.description} (v${ver})

Options:
  -V, --version            output the version number
  --json                   Emit machine-readable JSON where supported
  --verbose                Show additional diagnostic output
  --quiet                  Reduce nonessential terminal output
  -h, --help               display help for command

Commands:
  auth [options]           Configure local AI provider authentication credentials
  init [options]           Initialize workspace configuration
  plugin [list|init]       Manage workspace plugins, shortcuts, and rules
  config [command]         Inspect, validate, and set configuration settings
  explain [options] <target> Explain code, errors, or terminal output
  commit [options]         Draft and review commit messages
  summarize [options] <path> Summarize code, diffs, or project activity
  chat [options]           Start an interactive assistant chat session
  history [options]        View or clear saved chat session history
  help [command]           display help for command
`);
}

export async function parseAndRunNativeCli(argv = process.argv, commandService = new CommandService()) {
  const rawArgs = argv.slice(2);

  if (!rawArgs.length || rawArgs.includes("-h") || rawArgs.includes("--help")) {
    const helpCmdIndex = rawArgs.indexOf("help");
    const subCmd = helpCmdIndex >= 0 ? rawArgs[helpCmdIndex + 1] : rawArgs.find(a => !a.startsWith("-"));
    printHelpText(subCmd);
    process.exitCode = 0;
    return;
  }

  if (rawArgs.includes("-V") || rawArgs.includes("--version")) {
    console.log(appMetadata.version);
    process.exitCode = 0;
    return;
  }

  const { values, positionals } = parseArgs({
    args: rawArgs,
    options: {
      json: { type: "boolean" },
      verbose: { type: "boolean" },
      quiet: { type: "boolean" },
      provider: { type: "string", short: "p" },
      model: { type: "string" },
      style: { type: "string", short: "s" },
      scope: { type: "string" },
      dryRun: { type: "boolean" },
      interactive: { type: "boolean", short: "i" },
      validate: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      context: { type: "string", short: "c" },
      format: { type: "string", short: "f" },
      mode: { type: "string", short: "m" },
      resume: { type: "string", short: "r" },
      session: { type: "string" },
      list: { type: "boolean" },
      show: { type: "string" },
      clear: { type: "boolean" },
      name: { type: "string", short: "n" },
      stack: { type: "string" }
    },
    allowPositionals: true,
    strict: false
  });

  const commandName = positionals[0] || "";

  if (commandName === "help") {
    printHelpText(positionals[1]);
    process.exitCode = 0;
    return;
  }

  if (commandName === "auth") {
    await commandService.auth({ provider: values.provider });
    return;
  }

  if (commandName === "init") {
    await commandService.init({ name: values.name, stack: values.stack, yes: values.yes });
    return;
  }

  if (commandName === "plugin") {
    const action = positionals[1] || "list";
    if (action === "init") {
      await commandService.pluginService.initPluginTemplates();
      console.log("Plugin template initialized in .fortify/plugins/");
    } else {
      await commandService.pluginService.listPlugins();
    }
    return;
  }

  if (commandName === "config") {
    const action = positionals[1] || "list";
    const key = positionals[2] || "";
    const value = positionals[3] || "";
    await commandService.config({ action, key, value });
    return;
  }

  if (commandName === "explain") {
    const target = positionals[1] || "";
    await commandService.explain({
      target,
      context: values.context || "",
      provider: values.provider,
      model: values.model
    });
    return;
  }

  if (commandName === "commit") {
    await commandService.commit({
      style: values.style || "conventional",
      scope: values.scope || "",
      dryRun: Boolean(values.dryRun),
      interactive: Boolean(values.interactive),
      validate: Boolean(values.validate),
      yes: Boolean(values.yes),
      provider: values.provider,
      model: values.model
    });
    return;
  }

  if (commandName === "summarize") {
    const source = positionals[1] || "";
    await commandService.summarize({
      source,
      format: values.format || "bullet",
      provider: values.provider,
      model: values.model
    });
    return;
  }

  if (commandName === "chat") {
    const resumeId = values.resume || values.session || "";
    await commandService.chat({
      mode: values.mode || "default",
      sessionId: resumeId,
      provider: values.provider,
      model: values.model
    });
    return;
  }

  if (commandName === "history") {
    await commandService.history({
      list: Boolean(values.list || !positionals[1]),
      show: values.show || positionals[1] || "",
      clear: Boolean(values.clear)
    });
    return;
  }

  console.error(`Unknown command: '${commandName}'. Run '${appMetadata.cliName} --help' for available commands.`);
  process.exitCode = 1;
}
