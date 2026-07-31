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

export class CommitService {
  constructor({
    gitService = new GitService(),
    openAIService = new OpenAIService(),
    renderer = new CommitRenderer(),
    signalProcess = process
  } = {}) {
    this.gitService = gitService;
    this.openAIService = openAIService;
    this.renderer = renderer;
    this.signalProcess = signalProcess;
  }

  async runCommitFlow({ style = "conventional", scope = "", autoCommit = false, dryRun = false } = {}) {
    const isRepository = await this.gitService.isGitRepository();

    if (!isRepository) {
      this.renderer.showNotGitRepository();
      return { ok: false, reason: "not_git_repository" };
    }

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
      const instructions = buildCommitMessageInstructions({ style, scope });
      const input = buildCommitMessageInput({
        branchName,
        stagedDiff,
        style,
        scope
      });

      this.renderer.showGenerating();

      const stream = this.openAIService.streamResponse({
        input,
        instructions,
        signal: generationController.signal,
        temperature: 0.2,
        maxOutputTokens: 220
      });

      const rawMessage = await this.renderer.renderCommitMessageStream(stream, {
        signal: generationController.signal
      });

      const commitMessage = normalizeCommitMessage(rawMessage);
      if (!commitMessage) {
        this.renderer.showError("Generated commit message was empty.");
        return { ok: false, reason: "empty_message" };
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
}
