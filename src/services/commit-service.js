import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../config/index.js";
import {
  buildCommitMessageInput,
  buildCommitMessageInstructions
} from "../prompts/commit-message-prompt.js";
import { CommitRenderer } from "../renderers/index.js";
import {
  createCancellationController,
  isAbortLikeError
} from "../utils/operation-cancellation.js";
import { GitService } from "./git-service.js";
import { OpenAIService } from "./openai/index.js";
import { ProjectContextService } from "./project-context-service.js";

function normalizeCommitMessage(rawMessage) {
  if (typeof rawMessage !== "string") {
    return "";
  }

  const withoutFences = rawMessage.replace(/```[\s\S]*?```/g, (block) => {
    return block.replace(/```/g, "");
  });

  const normalizedLines = withoutFences
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  while (normalizedLines.length > 0 && !normalizedLines[normalizedLines.length - 1]) {
    normalizedLines.pop();
  }

  return normalizedLines.join("\n").trim();
}

import { ProviderFactory } from "./provider-factory.js";

export class CommitService {
  constructor({
    gitService = new GitService(),
    openAIService = new OpenAIService(),
    providerFactory = new ProviderFactory(),
    projectContextService = new ProjectContextService(),
    configLoader = loadConfig,
    fsPromises = { writeFile, readFile, unlink },
    childSpawner = spawn,
    renderer = new CommitRenderer(),
    signalProcess = process
  } = {}) {
    this.gitService = gitService;
    this.openAIService = openAIService;
    this.providerFactory = providerFactory;
    this.projectContextService = projectContextService;
    this.configLoader = configLoader;
    this.fs = fsPromises;
    this.childSpawner = childSpawner;
    this.renderer = renderer;
    this.signalProcess = signalProcess;
  }

  async runCommitFlow({ style = "conventional", scope = "", autoCommit = false, dryRun = false, interactive = false, validate = false, provider = "", model = "" } = {}) {
    const isRepository = await this.gitService.isGitRepository();

    if (!isRepository) {
      this.renderer.showNotGitRepository();
      return { ok: false, reason: "not_git_repository" };
    }

    const contextSummary = await this.projectContextService.getProjectContextSummary();
    const contextPrompt = this.projectContextService.formatSystemPromptContext(contextSummary);

    const stagedDiff = await this.gitService.getStagedDiff();
    if (!stagedDiff.trim()) {
      this.renderer.showNoStagedChanges();
      return { ok: false, reason: "no_staged_changes" };
    }

    const branchName = await this.gitService.getCurrentBranchName();
    const stagedDiffSummary = await this.gitService.getStagedDiffSummary();
    this.renderer.showContext({ branchName, style, scope });
    this.renderer.showDiffSummary(stagedDiffSummary);

    const { controller: generationController, cleanup: cleanupCancellation } = createCancellationController({
      signalProcess: this.signalProcess,
      cancelMessage: "Commit generation cancelled by Ctrl+C."
    });

    try {
      const instructions = buildCommitMessageInstructions({ style, scope }) + "\n\n" + contextPrompt;
      const input = buildCommitMessageInput({
        branchName,
        stagedDiff,
        style,
        scope
      });

      this.renderer.showGenerating();

      const providerService = await this.providerFactory.getProvider(provider);
      const stream = providerService.streamResponse({
        input,
        instructions,
        model: model || undefined,
        signal: generationController.signal,
        temperature: 0.2,
        maxOutputTokens: 220
      });

      const rawMessage = await this.renderer.renderCommitMessageStream(stream, {
        signal: generationController.signal
      });

      let commitMessage = normalizeCommitMessage(rawMessage);
      if (!commitMessage) {
        this.renderer.showError("Generated commit message was empty.");
        return { ok: false, reason: "empty_message" };
      }

      if (interactive) {
        commitMessage = await this.#editMessageInEditor(commitMessage);
        if (!commitMessage) {
          this.renderer.showError("Edited commit message was empty. Commit aborted.");
          return { ok: false, reason: "empty_message" };
        }
      }

      if (validate || style === "conventional") {
        const isValid = this.#validateConventionalCommit(commitMessage);
        if (!isValid) {
          const warningMsg = "Commit message does not match Conventional Commits format (e.g., 'feat: message' or 'fix(scope): message').";
          if (validate) {
            this.renderer.showError(warningMsg);
            return { ok: false, reason: "invalid_commit_format" };
          } else if (typeof this.renderer.showWarning === "function") {
            this.renderer.showWarning(warningMsg);
          }
        }
      }

      this.renderer.showResolvedMessage(commitMessage);

      if (dryRun) {
        this.renderer.showDryRunComplete();
        return { ok: true, committed: false, dryRun: true, message: commitMessage };
      }

      const shouldCommit = autoCommit ? true : await this.renderer.askForConfirmation();
      if (!shouldCommit) {
        this.renderer.showCommitSkipped();
        return { ok: true, committed: false, message: commitMessage };
      }

      const commitResult = await this.gitService.commitWithMessage({
        message: commitMessage
      });

      this.renderer.showCommitExecuted(commitMessage);
      return {
        ok: true,
        committed: true,
        message: commitMessage,
        output: commitResult.output
      };
    } catch (error) {
      if (generationController.signal.aborted || isAbortLikeError(error)) {
        this.renderer.showCommitSkipped();
        return { ok: false, reason: "cancelled" };
      }

      const message = error instanceof Error ? error.message : "Commit generation failed.";
      this.renderer.showError(message);
      return { ok: false, reason: "error", error };
    } finally {
      cleanupCancellation();
    }
  }

  async #editMessageInEditor(initialMessage) {
    let config;
    try {
      config = await this.configLoader();
    } catch {
      config = null;
    }
    const editorSetting = config?.editor || process.env.VISUAL || process.env.EDITOR;
    
    let editorCmd = editorSetting;
    if (!editorCmd) {
      editorCmd = process.platform === "win32" ? "notepad" : "nano";
    }

    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `FORTIFY_EDITMSG_${Date.now()}.txt`);

    try {
      await this.fs.writeFile(tempFile, initialMessage, "utf8");
      
      const parts = editorCmd.split(" ");
      const bin = parts[0];
      const args = [...parts.slice(1), tempFile];

      if (this.renderer.terminalUI && typeof this.renderer.terminalUI.info === "function") {
        this.renderer.terminalUI.info(`Opening editor (${editorCmd})...`);
      }

      await new Promise((resolve, reject) => {
        const child = this.childSpawner(bin, args, {
          stdio: "inherit",
          windowsHide: false
        });

        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Editor process exited with code ${code}`));
          }
        });
      });

      const editedContent = await this.fs.readFile(tempFile, "utf8");
      return normalizeCommitMessage(editedContent);
    } catch (err) {
      if (typeof this.renderer.showError === "function") {
        this.renderer.showError(`Failed to edit message in editor: ${err.message}`);
      }
      return initialMessage;
    } finally {
      try {
        await this.fs.unlink(tempFile);
      } catch {
        // ignore cleanup error
      }
    }
  }

  #validateConventionalCommit(message) {
    const firstLine = message.split("\n")[0].trim();
    const conventionalRegex = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9_-]+\))?: .+/;
    return conventionalRegex.test(firstLine);
  }
}
