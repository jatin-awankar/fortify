import { AuthService } from "./auth-service.js";
import { ChatService } from "./chat-service.js";
import { CommitService } from "./commit-service.js";
import { ConfigService } from "./config-service.js";
import { ExplainService } from "./explain-service.js";
import { HistoryService } from "./history-service.js";
import { SummarizeService } from "./summarize-service.js";
import { InitService } from "./init-service.js";
import { normalizeErrorForOutput } from "../utils/error-normalizer.js";
import { USER_CANCELLED_EXIT_CODE } from "../utils/operation-cancellation.js";
import { getRuntimeOptions } from "../utils/runtime-options.js";

export class CommandService {
  constructor({
    authService = new AuthService(),
    chatService = new ChatService(),
    configService = new ConfigService(),
    commitService = new CommitService(),
    explainService = new ExplainService(),
    historyService = new HistoryService(),
    summarizeService = new SummarizeService(),
    initService = new InitService(),
  } = {}) {
    this.authService = authService;
    this.chatService = chatService;
    this.configService = configService;
    this.commitService = commitService;
    this.explainService = explainService;
    this.historyService = historyService;
    this.summarizeService = summarizeService;
    this.initService = initService;
  }

  async explain(input) {
    const result = await this.explainService.runExplainFlow({
      target: input?.target,
      context: input?.context ?? "",
    });

    this.#completeResult(result);
  }

  async commit(input) {
    const result = await this.commitService.runCommitFlow({
      style: input?.style ?? "conventional",
      scope: input?.scope ?? "",
      autoCommit: Boolean(input?.yes),
      dryRun: Boolean(input?.dryRun),
      interactive: Boolean(input?.interactive),
      validate: Boolean(input?.validate),
    });

    this.#completeResult(result);
  }

  async config(input) {
    let result;

    if (input?.action === "get") {
      result = await this.configService.getConfig({ key: input.key });
    } else if (input?.action === "set") {
      result = await this.configService.setConfig({ key: input.key, value: input.value });
    } else if (input?.action === "validate") {
      result = await this.configService.validateConfig();
    } else {
      result = await this.configService.listConfig();
    }

    this.#completeResult(result);
  }

  async summarize(input) {
    const result = await this.summarizeService.runSummaryFlow({
      sourcePath: input?.source,
      format: input?.format ?? "bullet",
    });

    this.#completeResult(result);
  }

  async chat(input) {
    await this.chatService.startInteractiveChat({
      mode: input?.mode ?? "default",
      sessionId: input?.sessionId ?? "",
    });
  }

  async history(input) {
    const result = await this.historyService.showHistory({
      list: Boolean(input?.list),
      show: input?.show ?? "",
      clear: Boolean(input?.clear),
    });

    this.#completeResult(result);
  }

  async init(input) {
    const result = await this.initService.runInitFlow({
      name: input?.name,
      stack: input?.stack,
      yes: Boolean(input?.yes),
    });

    this.#completeResult(result);
  }

  async auth(input) {
    void input;
    const isAuthenticated = await this.authService.authenticateOpenAIKey();

    this.#completeResult(
      isAuthenticated
        ? { ok: true, authenticated: true }
        : { ok: false, reason: "auth_failed" },
    );
  }

  #completeResult(result) {
    this.#emitJsonResult(result);
    this.#setExitCodeFromResult(result);
  }

  #emitJsonResult(result) {
    if (!getRuntimeOptions().json || result?.json === false) {
      return;
    }

    const runtimeOptions = getRuntimeOptions();
    const payload = result?.ok
      ? result
      : normalizeErrorForOutput(result?.error, result?.reason ?? "error", {
        verbose: runtimeOptions.verbose,
      });

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  #setExitCodeFromResult(result) {
    if (!result?.ok && result?.reason === "cancelled") {
      process.exitCode = USER_CANCELLED_EXIT_CODE;
      return;
    }

    if (!result?.ok) {
      process.exitCode = 1;
    }
  }
}
