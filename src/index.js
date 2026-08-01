import { parseAndRunNativeCli } from "./commands/native-cli-parser.js";
import { setRuntimeOptions } from "./utils/runtime-options.js";

export async function runCli(argv = process.argv) {
  const rawArgs = argv.slice(2);
  const json = rawArgs.includes("--json");
  const verbose = rawArgs.includes("--verbose");
  const quiet = rawArgs.includes("--quiet");

  setRuntimeOptions({ json, verbose, quiet });
  await parseAndRunNativeCli(argv);
}
