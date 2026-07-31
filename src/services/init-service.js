import { createInterface } from "node:readline/promises";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { ProjectContextService } from "./project-context-service.js";
import { createTerminalUI } from "../renderers/index.js";

export class InitService {
  constructor({
    projectContextService = new ProjectContextService(),
    terminalUI = createTerminalUI(),
    fsPromises = { appendFile, readFile },
    input = process.stdin,
    output = process.stdout
  } = {}) {
    this.projectContextService = projectContextService;
    this.terminalUI = terminalUI;
    this.fs = fsPromises;
    this.input = input;
    this.output = output;
  }

  async runInitFlow({ name, stack, yes = false } = {}) {
    try {
      this.terminalUI.divider("Fortify Workspace Initialization");
      
      const configExists = await this.projectContextService.loadProjectConfig();
      if (configExists && !yes) {
        this.terminalUI.info("Workspace is already initialized (.fortify/project.json exists).");
      }

      const detectedStack = await this.projectContextService.detectStack();
      const defaultName = path.basename(this.projectContextService.cwd);
      const defaultStackStr = detectedStack.join(", ");

      let finalName = name || defaultName;
      let finalStackStr = stack || defaultStackStr;
      let addToGitignore = true;

      const isInteractive = this.terminalUI.capabilities.isInteractive && !yes;

      if (isInteractive) {
        const rl = createInterface({
          input: this.input,
          output: this.output
        });

        try {
          const inputName = await rl.question(`Project Name [${defaultName}]: `);
          if (inputName.trim()) {
            finalName = inputName.trim();
          }

          const inputStack = await rl.question(`Project Stack [${defaultStackStr}]: `);
          if (inputStack.trim()) {
            finalStackStr = inputStack.trim();
          }

          const inputGitignore = await rl.question(`Add .fortify/ to .gitignore? (y/n) [y]: `);
          if (inputGitignore.trim().toLowerCase() === "n") {
            addToGitignore = false;
          }
        } finally {
          rl.close();
        }
      }

      const projectConfig = {
        name: finalName,
        stack: finalStackStr.split(",").map(s => s.trim()).filter(Boolean),
        instructions: configExists?.instructions || "This project is built using high quality development standards.",
        updatedAt: new Date().toISOString()
      };

      await this.projectContextService.saveProjectConfig(projectConfig);
      this.terminalUI.success(`Created configuration: ${this.projectContextService.getProjectConfigPath()}`);

      if (addToGitignore) {
        await this.#updateGitignore();
      }

      return {
        ok: true,
        name: finalName,
        stack: projectConfig.stack
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initialize workspace.";
      this.terminalUI.error(message);
      return { ok: false, error };
    }
  }

  async #updateGitignore() {
    const gitignorePath = path.join(this.projectContextService.cwd, ".gitignore");
    try {
      let content = "";
      try {
        content = await this.fs.readFile(gitignorePath, "utf8");
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }

      if (content.includes(".fortify/")) {
        this.terminalUI.info(".fortify/ is already in .gitignore.");
        return;
      }

      const appendStr = content ? "\n# Fortify context directory\n.fortify/\n" : "# Fortify context directory\n.fortify/\n";
      await this.fs.appendFile(gitignorePath, appendStr, "utf8");
      this.terminalUI.success("Added .fortify/ to .gitignore.");
    } catch (err) {
      this.terminalUI.warning(`Could not update .gitignore: ${err.message}`);
    }
  }
}
