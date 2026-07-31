import { appMetadata } from "../config/app-metadata.js";

export function createCommitCommand(commandService) {
  return {
    name: "commit",
    description: "Draft and review commit messages.",
    configure(command) {
      command
        .summary("Prepare commit message drafts")
        .description(
          "Create commit message suggestions from staged changes and repository context."
        )
        .option("-s, --style <style>", "Commit style convention", "conventional")
        .option("--scope <scope>", "Optional commit scope")
        .option("--dry-run", "Generate and display a commit message without committing")
        .option("-i, --interactive", "Edit commit message in your preferred editor before committing")
        .option("--validate", "Enforce Conventional Commits specification format")
        .option("-y, --yes", "Skip confirmation and commit automatically")
        .addHelpText(
          "after",
          `\nExample:\n  ${appMetadata.cliName} commit --style conventional --scope cli`
        )
        .action(async (options) => {
          await commandService.commit({
            style: options.style,
            scope: options.scope ?? "",
            dryRun: options.dryRun ?? false,
            yes: options.yes ?? false,
            interactive: options.interactive ?? false,
            validate: options.validate ?? false
          });
        });
    }
  };
}
