import { parseArgs } from "node:util";
import { appMetadata } from "../config/app-metadata.js";
import { CommandService } from "../services/command-service.js";

export function printHelpText(subcommand = "") {
  const name = appMetadata.cliName;
  const ver = appMetadata.version;

  if (subcommand === "commit") {
    process.stdout.write(`Usage: ${name} commit [options]

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
\n`);
    return;
  }

  if (subcommand === "config") {
    process.stdout.write(`Usage: ${name} config [command] [options]

Inspect, validate, and update local configuration settings.

Commands:
  list                     List all configuration options
  get <key>                Get a configuration option by key
  set <key> <value>        Set a configuration option by key
  validate                 Validate local configuration settings
  -h, --help               display help for command
\n`);
    return;
  }

  if (subcommand === "plugin") {
    process.stdout.write(`Usage: ${name} plugin [command]

Manage workspace plugins, shortcuts, and rules.

Commands:
  list                     List loaded workspace plugins
  init                     Initialize sample plugin shortcuts
  -h, --help               display help for command\n\n`);
    return;
  }

  if (subcommand === "run") {
    process.stdout.write(`Usage: ${name} run [options] "<prompt>"

Run a single agentic task (headless, non-interactive execution).
All tool operations are auto-approved, making this safe for CI/CD usage.

Options:
  -p, --provider <name>    Override active AI provider (openai, anthropic, gemini, ollama)
  --model <name>           Override active model name
  --timeout <seconds>      Set a wall-clock timeout for the run
  --max-iterations <count> Set maximum agentic loop iterations (default: 25)
  --json                   Emit machine-readable JSON output
  -h, --help               display help for command
\n`);
    return;
  }

  if (subcommand === "doctor") {
    process.stdout.write(`Usage: ${name} doctor [options]

Check Fortify setup and diagnose issues with environment, API keys, Git, and test commands.

Options:
  --json                   Emit machine-readable JSON output
  -h, --help               display help for command
\n`);
    return;
  }

  const KNOWN_COMMANDS = new Set(["auth", "init", "explain", "summarize", "chat", "history", "run", "doctor"]);
  if (KNOWN_COMMANDS.has(subcommand)) {
    process.stdout.write(`Usage: ${name} ${subcommand} [options]\n\nRun '${name} --help' for an overview of all commands.\n`);
    return;
  }

  process.stdout.write(`Usage: ${name} [options] [command]

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
  run <prompt>             Run a single agentic task (headless, CI/CD-friendly)
  doctor                   Check Fortify setup and diagnose issues
  history [options]        View or clear saved chat session history
  help [command]           display help for command
\n`);
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
      stack: { type: "string" },
      timeout: { type: "string" },
      "max-iterations": { type: "string" },
    },
    allowPositionals: true,
    strict: false
  });

  const KNOWN_COMMANDS = new Set(["auth", "init", "plugin", "config", "explain", "commit", "summarize", "chat", "history", "run", "doctor", "help"]);
  const cmdIdx = positionals.findIndex((p) => KNOWN_COMMANDS.has(p));
  const commandName = cmdIdx >= 0 ? positionals[cmdIdx] : (positionals[0] || "");
  const commandArgs = cmdIdx >= 0 ? positionals.slice(cmdIdx + 1) : positionals.slice(1);

  if (commandName === "help") {
    printHelpText(commandArgs[0]);
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
    const action = commandArgs[0] || "list";
    if (action === "init") {
      await commandService.initPluginTemplates();
    } else if (action === "list") {
      await commandService.listPlugins();
    } else {
      console.error(`error: unknown command '${action}' for 'plugin'`);
      process.exitCode = 1;
    }
    return;
  }

  if (commandName === "config") {
    const action = commandArgs[0] || "list";
    if (!["list", "get", "set", "validate"].includes(action)) {
      console.error(`error: unknown command '${action}' for 'config'`);
      process.exitCode = 1;
      return;
    }
    const key = commandArgs[1] || "";
    if ((action === "get" || action === "set") && !key) {
      console.error(`error: missing required argument 'key'`);
      process.exitCode = 1;
      return;
    }
    const value = commandArgs[2] || "";
    if (action === "set" && !value) {
      console.error(`error: missing required argument 'value'`);
      process.exitCode = 1;
      return;
    }
    await commandService.config({ action, key, value });
    return;
  }

  if (commandName === "explain") {
    const target = commandArgs[0] || "";
    if (!target) {
      console.error(`error: missing required argument 'file-or-text'`);
      process.exitCode = 1;
      return;
    }
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
    const source = commandArgs[0] || "";
    if (!source) {
      console.error(`error: missing required argument 'path'`);
      process.exitCode = 1;
      return;
    }
    await commandService.summarize({
      source,
      format: values.format || "bullet",
      provider: values.provider,
      model: values.model
    });
    return;
  }

  if (commandName === "chat") {
    const resumeId = values.resume === true ? "latest" : (values.resume || values.session || "");
    await commandService.chat({
      mode: values.mode || "default",
      sessionId: resumeId,
      provider: values.provider,
      model: values.model
    });
    return;
  }

  if (commandName === "history") {
    const isClear = Boolean(values.clear || commandArgs[0] === "clear");
    const showTarget = values.show || (commandArgs[0] && !["clear", "list"].includes(commandArgs[0]) ? commandArgs[0] : "");
    await commandService.history({
      list: Boolean(values.list || (!showTarget && !isClear)),
      show: showTarget,
      clear: isClear
    });
    return;
  }

  if (commandName === "run") {
    const prompt = commandArgs.join(" ").trim();
    if (!prompt) {
      console.error(`error: missing required argument 'prompt'. Usage: ${appMetadata.cliName} run "<prompt>"`);
      process.exitCode = 1;
      return;
    }
    await commandService.run({
      prompt,
      provider: values.provider,
      model: values.model,
      timeout: values.timeout ? parseInt(values.timeout, 10) : 0,
      maxIterations: values["max-iterations"] ? parseInt(values["max-iterations"], 10) : 25,
      yes: true, // Always auto-approve in headless mode
    });
    return;
  }

  if (commandName === "doctor") {
    await commandService.doctor();
    return;
  }

  console.error(`Unknown command: '${commandName}'. Run '${appMetadata.cliName} --help' for available commands.`);
  process.exitCode = 1;
}
