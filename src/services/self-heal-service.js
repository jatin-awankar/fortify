/**
 * Self-Heal Service — automatic test → fix → retry orchestration.
 *
 * Wraps the agentic loop with safety-net logic:
 *
 *  1. Create checkpoint (git stash) before agentic turn
 *  2. Run agentic turn (LLM ↔ tools)
 *  3. If mutation tools were used AND a test command exists:
 *     a. Run tests
 *     b. If PASS → drop checkpoint, return success
 *     c. If FAIL → feed test output back to LLM for fix (up to maxRetries)
 *     d. If max retries exhausted → restore checkpoint, report failure
 *  4. If no mutation tools used → skip testing, return result as-is
 *
 * Zero external dependencies.
 */

import { MUTATION_TOOLS } from "./agentic-loop.js";

/**
 * Default maximum number of self-heal retry attempts.
 */
const DEFAULT_MAX_RETRIES = 3;

export class SelfHealService {
  /**
   * @param {object} options
   * @param {import("./git-checkpoint-service.js").GitCheckpointService} options.gitCheckpointService
   * @param {import("./test-runner-service.js").TestRunnerService} options.testRunnerService
   * @param {number} [options.maxRetries=3] - Maximum self-heal retry attempts
   * @param {Function} [options.onCheckpointCreated] - Called when a checkpoint is created
   * @param {Function} [options.onTestStart] - Called when tests begin running
   * @param {Function} [options.onTestResult] - Called with each test result
   * @param {Function} [options.onRetry] - Called before each retry attempt
   * @param {Function} [options.onRollback] - Called when rolling back to checkpoint
   */
  constructor({
    gitCheckpointService,
    testRunnerService,
    maxRetries = DEFAULT_MAX_RETRIES,
    onCheckpointCreated,
    onTestStart,
    onTestResult,
    onRetry,
    onRollback,
  } = {}) {
    if (!gitCheckpointService) {
      throw new Error("SelfHealService requires a gitCheckpointService.");
    }
    if (!testRunnerService) {
      throw new Error("SelfHealService requires a testRunnerService.");
    }

    this.checkpointService = gitCheckpointService;
    this.testRunner = testRunnerService;
    this.maxRetries = maxRetries;

    // Lifecycle hooks
    this.onCheckpointCreated = onCheckpointCreated || (() => {});
    this.onTestStart = onTestStart || (() => {});
    this.onTestResult = onTestResult || (() => {});
    this.onRetry = onRetry || (() => {});
    this.onRollback = onRollback || (() => {});
  }

  /**
   * Run an agentic turn with self-healing safety net.
   *
   * @param {object} options
   * @param {import("./agentic-loop.js").AgenticLoop} options.agenticLoop - The agentic loop instance
   * @param {object} options.runOptions - Options to pass to agenticLoop.run()
   * @param {string} options.cwd - Working directory (project root)
   * @param {string|null} options.testCommand - Test command (null = skip testing)
   * @returns {Promise<SelfHealResult>}
   *
   * @typedef {{
   *   text: string,
   *   toolResults: object[],
   *   iterations: number,
   *   aborted: boolean,
   *   selfHeal: {
   *     checkpointCreated: boolean,
   *     testsPassed: boolean|null,
   *     selfHealAttempts: number,
   *     rolledBack: boolean,
   *     testResults: object[],
   *   }
   * }} SelfHealResult
   */
  async run({ agenticLoop, runOptions, cwd, testCommand } = {}) {
    const selfHeal = {
      checkpointCreated: false,
      testsPassed: null,
      selfHealAttempts: 0,
      rolledBack: false,
      testResults: [],
    };

    // Track mutations across all iterations
    let hadMutations = false;

    // Wire up mutation tracking via the loop's lifecycle hooks
    const originalOnAfterIteration = agenticLoop.onAfterIteration;
    agenticLoop.onAfterIteration = (info) => {
      if (info.hasMutations) {
        hadMutations = true;
      }
      originalOnAfterIteration(info);
    };

    try {
      // Step 1: Create checkpoint
      const checkpoint = await this.checkpointService.createCheckpoint({
        cwd,
        label: "pre-edit",
      });

      selfHeal.checkpointCreated = checkpoint.created;
      if (checkpoint.created) {
        this.onCheckpointCreated(checkpoint);
      }

      // Step 2: Run initial agentic turn
      let result = await agenticLoop.run(runOptions);

      // If aborted, skip testing and return immediately
      if (result.aborted) {
        return { ...result, selfHeal };
      }

      // Step 3: Test cycle (only if mutations occurred and test command exists)
      if (hadMutations && testCommand) {
        const testCycleResult = await this.#runTestCycle({
          agenticLoop,
          runOptions,
          result,
          cwd,
          testCommand,
          selfHeal,
        });

        // Update result with the latest from test cycle
        result = testCycleResult.result;
      }

      return { ...result, selfHeal };
    } finally {
      // Restore original hook
      agenticLoop.onAfterIteration = originalOnAfterIteration;
    }
  }

  /**
   * Run the test → fix → retry cycle.
   *
   * @private
   */
  async #runTestCycle({ agenticLoop, runOptions, result, cwd, testCommand, selfHeal }) {
    let currentResult = result;

    // Run tests
    this.onTestStart(testCommand);
    const testResult = await this.testRunner.runTests({ cwd, command: testCommand });
    selfHeal.testResults.push(testResult);
    this.onTestResult(testResult);

    if (testResult.passed) {
      selfHeal.testsPassed = true;

      // Tests passed — drop the checkpoint (no longer needed)
      if (selfHeal.checkpointCreated) {
        await this.checkpointService.dropCheckpoint({ cwd });
      }

      return { result: currentResult };
    }

    // Tests failed — enter self-heal retry loop
    selfHeal.testsPassed = false;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      selfHeal.selfHealAttempts = attempt;
      this.onRetry(attempt, this.maxRetries);

      // Feed test failure into the conversation for the LLM to fix
      const failureMessage = this.#buildTestFailureMessage(testResult, attempt);

      // Inject the failure as a new user message in the conversation
      const augmentedRunOptions = this.#augmentWithFailure(runOptions, failureMessage);

      // Run another agentic turn with the test failure context
      currentResult = await agenticLoop.run(augmentedRunOptions);

      if (currentResult.aborted) {
        return { result: currentResult };
      }

      // Re-run tests
      this.onTestStart(testCommand);
      const retryTestResult = await this.testRunner.runTests({ cwd, command: testCommand });
      selfHeal.testResults.push(retryTestResult);
      this.onTestResult(retryTestResult);

      if (retryTestResult.passed) {
        selfHeal.testsPassed = true;

        // Tests passed! Drop the checkpoint
        if (selfHeal.checkpointCreated) {
          await this.checkpointService.dropCheckpoint({ cwd });
        }

        return { result: currentResult };
      }
    }

    // Max retries exhausted — rollback to checkpoint
    if (selfHeal.checkpointCreated) {
      const rollbackResult = await this.checkpointService.restoreCheckpoint({ cwd });
      selfHeal.rolledBack = rollbackResult.restored;
      this.onRollback(rollbackResult);
    }

    return { result: currentResult };
  }

  /**
   * Build a failure message to inject into the conversation.
   *
   * @private
   * @param {object} testResult - Test result from TestRunnerService
   * @param {number} attempt - Current retry attempt number
   * @returns {string}
   */
  #buildTestFailureMessage(testResult, attempt) {
    const parts = [
      `[Self-Heal Attempt ${attempt}/${this.maxRetries}]`,
      "",
      "The tests are failing after your changes. Please analyze the test output below and fix the issues.",
      "",
      `Test command exited with code ${testResult.exitCode}.`,
    ];

    if (testResult.summary) {
      const s = testResult.summary;
      parts.push(`Results: ${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped (${s.total} total)`);
    }

    // Include test output (truncated for token efficiency)
    const output = [testResult.stdout, testResult.stderr].filter(Boolean).join("\n").trim();
    if (output) {
      const maxChars = 3000;
      const trimmedOutput = output.length > maxChars
        ? "...\n" + output.slice(-maxChars)
        : output;
      parts.push("");
      parts.push("--- Test Output ---");
      parts.push(trimmedOutput);
    }

    parts.push("");
    parts.push("Fix the failing tests. Read the relevant files, make targeted edits, and ensure all tests pass.");

    return parts.join("\n");
  }

  /**
   * Augment run options with a test failure message appended to conversation.
   *
   * @private
   * @param {object} runOptions - Original agentic loop run options
   * @param {string} failureMessage - Failure message to inject
   * @returns {object} New run options with failure message in messages
   */
  #augmentWithFailure(runOptions, failureMessage) {
    const augmentedMessages = [
      ...(runOptions.messages || []),
      {
        role: "user",
        content: failureMessage,
      },
    ];

    return {
      ...runOptions,
      messages: augmentedMessages,
    };
  }
}

/**
 * Create a SelfHealService instance.
 * @param {object} options
 * @returns {SelfHealService}
 */
export function createSelfHealService(options) {
  return new SelfHealService(options);
}

export { DEFAULT_MAX_RETRIES };
