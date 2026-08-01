import path from "node:path";
import { appMetadata } from "../config/app-metadata.js";
import {
  buildChunkSummaryInput,
  buildChunkSummaryInstructions,
  buildFinalSummaryInput,
  buildFinalSummaryInstructions
} from "../prompts/project-summarizer-prompt.js";
import { SummarizeRenderer } from "../renderers/index.js";
import {
  collectProjectTextFiles,
  readTextFileForSummary,
  resolveSourcePath
} from "../utils/project-files.js";
import {
  createCancellationController,
  isAbortLikeError
} from "../utils/operation-cancellation.js";
import { chunkText } from "../utils/text-chunker.js";
import { estimateTokenCountFromText, trimItemsToTokenBudget } from "../utils/token-safety.js";
import { OpenAIService } from "./openai/index.js";
import { ProviderFactory } from "./provider-factory.js";

const SUMMARY_SAFETY_LIMITS = {
  maxFiles: 200,
  maxFileChars: 80_000,
  maxChunksTotal: 120,
  maxChunkChars: 6_000,
  chunkOverlapChars: 300,
  maxIntermediateSummaryTokens: 24_000,
  maxFinalContextTokens: 28_000
};

export class SummarizeService {
  constructor({
    openAIService = new OpenAIService(),
    providerFactory = new ProviderFactory(),
    renderer = new SummarizeRenderer(),
    cwd = process.cwd(),
    signalProcess = process
  } = {}) {
    this.openAIService = openAIService;
    this.providerFactory = providerFactory;
    this.renderer = renderer;
    this.cwd = cwd;
    this.signalProcess = signalProcess;
  }

  async runSummaryFlow({ sourcePath, format = "bullet", provider = "", model = "" } = {}) {
    if (!sourcePath) {
      this.renderer.showError(
        `A target path is required. Usage: ${appMetadata.cliName} summarize <path>`
      );
      return { ok: false, reason: "missing_path" };
    }

    let resolvedSource;
    try {
      resolvedSource = await resolveSourcePath(sourcePath, { cwd: this.cwd });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to resolve target path.";
      this.renderer.showError(message);
      return { ok: false, reason: "invalid_path" };
    }

    const { absolutePath, sourceStats } = resolvedSource;
    this.renderer.showStart({ sourcePath: absolutePath });

    let filesToProcess = [];
    if (sourceStats.isFile()) {
      filesToProcess = [absolutePath];
    } else if (sourceStats.isDirectory()) {
      filesToProcess = await collectProjectTextFiles(absolutePath, {
        maxFiles: SUMMARY_SAFETY_LIMITS.maxFiles
      });
    } else {
      this.renderer.showError("Target path must be a file or directory.");
      return { ok: false, reason: "unsupported_path_type" };
    }

    if (!filesToProcess.length) {
      this.renderer.showNoFilesFound();
      return { ok: false, reason: "no_files" };
    }

    this.renderer.showDiscovery({ fileCount: filesToProcess.length });

    const { controller: summaryController, cleanup: cleanupCancellation } = createCancellationController({
      signalProcess: this.signalProcess,
      cancelMessage: "Summary cancelled by Ctrl+C."
    });

    let chunkSummaryEntries = [];
    let totalChunksProcessed = 0;
    let consumedSummaryTokens = 0;
    let stopProcessing = false;

    try {
      const providerService = await this.providerFactory.getProvider(provider);

      for (const absoluteFilePath of filesToProcess) {
        if (stopProcessing || summaryController.signal.aborted) {
          break;
        }

        const fileReadResult = await readTextFileForSummary(absoluteFilePath, {
          maxChars: SUMMARY_SAFETY_LIMITS.maxFileChars
        });

        if (!fileReadResult.isText || !fileReadResult.content) {
          continue;
        }

        if (fileReadResult.truncated) {
          this.renderer.showTokenGuardNotice(
            `Truncated large file for safety: ${path.relative(absolutePath, absoluteFilePath) || path.basename(absoluteFilePath)}`
          );
        }

        const contentChunks = chunkText(fileReadResult.content, {
          chunkSize: SUMMARY_SAFETY_LIMITS.maxChunkChars,
          overlap: SUMMARY_SAFETY_LIMITS.chunkOverlapChars
        });

        if (!contentChunks.length) {
          continue;
        }

        for (let chunkIndex = 0; chunkIndex < contentChunks.length; chunkIndex += 1) {
          if (summaryController.signal.aborted) {
            stopProcessing = true;
            break;
          }

          if (totalChunksProcessed >= SUMMARY_SAFETY_LIMITS.maxChunksTotal) {
            this.renderer.showTokenGuardNotice(
              `Reached chunk safety cap (${SUMMARY_SAFETY_LIMITS.maxChunksTotal}).`
            );
            stopProcessing = true;
            break;
          }

          const relativePath = path.relative(absolutePath, absoluteFilePath) || path.basename(absoluteFilePath);
          this.renderer.showChunkProgress({
            filePath: relativePath,
            chunkIndex,
            totalChunks: contentChunks.length
          });

          let chunkSummaryResponse;
          if (typeof providerService.generateResponse === "function") {
            chunkSummaryResponse = await providerService.generateResponse({
              input: buildChunkSummaryInput({
                relativePath,
                chunkIndex,
                totalChunks: contentChunks.length,
                chunkContent: contentChunks[chunkIndex]
              }),
              instructions: buildChunkSummaryInstructions(),
              model: model || undefined,
              temperature: 0.2,
              maxOutputTokens: 280,
              signal: summaryController.signal
            });
          } else {
            let streamOutputText = "";
            const chunkStream = providerService.streamResponse({
              input: buildChunkSummaryInput({
                relativePath,
                chunkIndex,
                totalChunks: contentChunks.length,
                chunkContent: contentChunks[chunkIndex]
              }),
              instructions: buildChunkSummaryInstructions(),
              model: model || undefined,
              temperature: 0.2,
              maxOutputTokens: 280,
              signal: summaryController.signal
            });
            for await (const chunk of chunkStream) {
              if (chunk.type === "text_delta") streamOutputText += chunk.delta;
            }
            chunkSummaryResponse = { outputText: streamOutputText };
          }

          const summaryText = chunkSummaryResponse.outputText.trim();
          if (!summaryText) {
            continue;
          }

          const summaryTokenEstimate = estimateTokenCountFromText(summaryText);
          if (
            consumedSummaryTokens + summaryTokenEstimate >
            SUMMARY_SAFETY_LIMITS.maxIntermediateSummaryTokens
          ) {
            this.renderer.showTokenGuardNotice(
              `Reached intermediate summary token budget (${SUMMARY_SAFETY_LIMITS.maxIntermediateSummaryTokens}).`
            );
            stopProcessing = true;
            break;
          }

          consumedSummaryTokens += summaryTokenEstimate;
          totalChunksProcessed += 1;
          chunkSummaryEntries.push({
            relativePath,
            chunkIndex,
            totalChunks: contentChunks.length,
            summary: summaryText
          });
        }
      }

      if (summaryController.signal.aborted) {
        this.renderer.showTokenGuardNotice("Summary generation cancelled.");
        return { ok: false, reason: "cancelled" };
      }

      if (!chunkSummaryEntries.length) {
        this.renderer.showError("No chunk summaries were generated.");
        return { ok: false, reason: "no_chunk_summaries" };
      }

      const chunkSummariesForFinalInput = trimItemsToTokenBudget(chunkSummaryEntries, {
        maxTokens: SUMMARY_SAFETY_LIMITS.maxFinalContextTokens,
        textSelector: (entry) => `${entry.relativePath}\n${entry.summary}`
      });

      if (chunkSummariesForFinalInput.length < chunkSummaryEntries.length) {
        this.renderer.showTokenGuardNotice(
          `Trimmed final synthesis context to ${chunkSummariesForFinalInput.length} chunk summaries for token safety.`
        );
      }

      this.renderer.showFinalStart();
      const finalSummaryStream = providerService.streamResponse({
        input: buildFinalSummaryInput({
          sourcePath: absolutePath,
          totalFiles: filesToProcess.length,
          totalChunks: totalChunksProcessed,
          chunkSummaries: chunkSummariesForFinalInput
        }),
        instructions: buildFinalSummaryInstructions({ format }),
        model: model || undefined,
        temperature: 0.2,
        maxOutputTokens: 1_200,
        signal: summaryController.signal
      });

      const finalSummaryText = await this.renderer.renderFinalSummaryStream(finalSummaryStream, {
        signal: summaryController.signal
      });

      this.renderer.showDone();
      return {
        ok: true,
        summary: finalSummaryText
      };
    } catch (error) {
      if (summaryController.signal.aborted || isAbortLikeError(error)) {
        this.renderer.showTokenGuardNotice("Summary generation cancelled.");
        return { ok: false, reason: "cancelled" };
      }

      const message = error instanceof Error ? error.message : "Project summary failed.";
      this.renderer.showError(message);
      return { ok: false, reason: "error", error };
    } finally {
      cleanupCancellation();
    }
  }
}
