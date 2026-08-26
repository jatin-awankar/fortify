import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { appMetadata } from "../config/app-metadata.js";
import { buildExplainInput, buildExplainInstructions } from "../prompts/explain-error-prompt.js";
import { ExplainRenderer } from "../renderers/index.js";
import {
  createCancellationController,
  isAbortLikeError
} from "../utils/operation-cancellation.js";
import { detectNodeStackTrace } from "../utils/stack-trace.js";
import { OpenAIService } from "./openai/index.js";
import { ProjectContextService } from "./project-context-service.js";

import { ProviderFactory } from "./provider-factory.js";

const MAX_INPUT_CHARS = 40_000;

function truncateInputText(inputText) {
  if (inputText.length <= MAX_INPUT_CHARS) {
    return inputText;
  }

  const omitted = inputText.length - MAX_INPUT_CHARS;
  return `${inputText.slice(0, MAX_INPUT_CHARS)}\n\n[Input truncated: ${omitted} characters omitted]`;
}

export class ExplainService {
  constructor({
    openAIService = new OpenAIService(),
    providerFactory = new ProviderFactory(),
    renderer = new ExplainRenderer(),
    projectContextService = new ProjectContextService(),
    cwd = process.cwd(),
    signalProcess = process
  } = {}) {
    this.openAIService = openAIService;
    this.providerFactory = providerFactory;
    this.renderer = renderer;
    this.projectContextService = projectContextService;
    this.cwd = cwd;
    this.signalProcess = signalProcess;
  }

  async runExplainFlow({ target, context = "", provider = "", model = "" } = {}) {
    if (!target) {
      this.renderer.showError(
        `Target is required. Usage: ${appMetadata.cliName} explain <file-or-text>`
      );
      return { ok: false, reason: "missing_target" };
    }

    let resolvedInput;
    try {
      resolvedInput = await this.#resolveInput(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read explain input.";
      this.renderer.showError(message);
      return { ok: false, reason: "input_error" };
    }

    const contextSummary = await this.projectContextService.getProjectContextSummary();
    const contextPrompt = this.projectContextService.formatFullSystemPrompt(contextSummary);

    const stackTrace = detectNodeStackTrace(resolvedInput.rawText);
    this.renderer.showStart({
      sourceLabel: resolvedInput.sourceLabel,
      sourceType: resolvedInput.sourceType
    });
    this.renderer.showStackTraceDetection(stackTrace);

    const { controller: explanationController, cleanup: cleanupCancellation } = createCancellationController({
      signalProcess: this.signalProcess,
      cancelMessage: "Explanation cancelled by Ctrl+C."
    });

    try {
      const instructions = buildExplainInstructions({
        hasStackTrace: stackTrace.detected
      }) + "\n\n" + contextPrompt;
      const input = buildExplainInput({
        sourceLabel: resolvedInput.sourceLabel,
        sourceType: resolvedInput.sourceType,
        rawErrorText: truncateInputText(resolvedInput.rawText),
        additionalContext: context,
        stackTrace
      });

      this.renderer.showStreamingStart();
      const providerService = await this.providerFactory.getProvider(provider);
      const stream = providerService.streamResponse({
        input,
        instructions,
        model: model || undefined,
        temperature: 0.2,
        maxOutputTokens: 1_100,
        signal: explanationController.signal
      });

      const explanation = await this.renderer.renderExplanationStream(stream, {
        signal: explanationController.signal
      });

      this.renderer.showDone();
      return {
        ok: true,
        explanation
      };
    } catch (error) {
      if (explanationController.signal.aborted || isAbortLikeError(error)) {
        this.renderer.showCancelled();
        return { ok: false, reason: "cancelled" };
      }

      const message = error instanceof Error ? error.message : "Error explanation failed.";
      this.renderer.showError(message);
      return { ok: false, reason: "error", error };
    } finally {
      cleanupCancellation();
    }
  }

  async #resolveInput(target) {
    try {
      const possiblePath = path.resolve(this.cwd, target);
      const targetStats = await stat(possiblePath);
      if (targetStats.isDirectory()) {
        throw new Error("Target path is a directory. Provide a stack-trace file or inline text.");
      }

      const fileContent = await readFile(possiblePath, "utf8");
      return {
        sourceType: "file",
        sourceLabel: possiblePath,
        rawText: fileContent
      };
    } catch (error) {
      if (error?.message?.includes("is a directory") || error?.code === "EISDIR") {
        throw error;
      }

      return {
        sourceType: "text",
        sourceLabel: "inline",
        rawText: target
      };
    }
  }
}
