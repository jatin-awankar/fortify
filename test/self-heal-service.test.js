import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { SelfHealService, DEFAULT_MAX_RETRIES } from "../src/services/self-heal-service.js";

/**
 * Create a mock GitCheckpointService.
 */
function createMockCheckpointService({
  createResult = { created: true, message: "fortify/checkpoint/test", timestamp: "test" },
  dropResult = { dropped: true },
  restoreResult = { restored: true, message: "Restored" },
} = {}) {
  return {
    createCheckpoint: async () => createResult,
    dropCheckpoint: async () => dropResult,
    restoreCheckpoint: async () => restoreResult,
  };
}

/**
 * Create a mock TestRunnerService.
 */
function createMockTestRunner(results = []) {
  let callIndex = 0;
  return {
    runTests: async () => {
      const result = results[callIndex] || results[results.length - 1] || {
        passed: true,
        exitCode: 0,
        stdout: "All tests passed",
        stderr: "",
        durationMs: 100,
        truncated: false,
        timedOut: false,
        summary: { total: 10, passed: 10, failed: 0, skipped: 0 },
      };
      callIndex++;
      return result;
    },
  };
}

/**
 * Create a mock AgenticLoop.
 */
function createMockAgenticLoop({
  results = [],
  triggerMutations = true,
} = {}) {
  let callIndex = 0;

  return {
    onAfterIteration: () => {},
    run: async (runOptions) => {
      const result = results[callIndex] || results[results.length - 1] || {
        text: "Done",
        toolResults: [],
        iterations: 1,
        aborted: false,
      };
      callIndex++;

      // Simulate onAfterIteration being called (to track mutations)
      if (triggerMutations && typeof result._triggerMutation !== "undefined" ? result._triggerMutation : triggerMutations) {
        // The SelfHealService wires this up, so we need to call it
        if (typeof mockLoop.onAfterIteration === "function") {
          mockLoop.onAfterIteration({ iteration: 1, toolResults: [], hasMutations: true });
        }
      }

      return result;
    },
  };

  // This is hoisted to allow the closure to reference it
  var mockLoop;
  // Re-assign after definition — this is intentional
}

/**
 * Create a proper mock loop that triggers mutations via the self-heal service's hook.
 */
function createAgenticLoopWithMutations(results = [], { triggerMutations = true } = {}) {
  let callIndex = 0;
  const loop = {
    onAfterIteration: () => {},
    run: async (runOptions) => {
      const result = results[callIndex] || results[results.length - 1] || {
        text: "Done",
        toolResults: [],
        iterations: 1,
        aborted: false,
      };
      callIndex++;

      // Trigger the onAfterIteration hook (which SelfHealService replaces)
      if (triggerMutations) {
        loop.onAfterIteration({ iteration: 1, toolResults: [], hasMutations: true });
      }

      return result;
    },
  };
  return loop;
}

describe("SelfHealService", () => {
  describe("constructor", () => {
    it("should require gitCheckpointService", () => {
      assert.throws(() => {
        new SelfHealService({
          testRunnerService: createMockTestRunner(),
        });
      }, /gitCheckpointService/);
    });

    it("should require testRunnerService", () => {
      assert.throws(() => {
        new SelfHealService({
          gitCheckpointService: createMockCheckpointService(),
        });
      }, /testRunnerService/);
    });

    it("should accept all required options", () => {
      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: createMockTestRunner(),
      });
      assert.ok(service);
      assert.equal(service.maxRetries, DEFAULT_MAX_RETRIES);
    });

    it("should accept custom maxRetries", () => {
      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: createMockTestRunner(),
        maxRetries: 5,
      });
      assert.equal(service.maxRetries, 5);
    });
  });

  describe("run — happy path", () => {
    it("should create checkpoint, run tests, drop checkpoint on success", async () => {
      let checkpointDropped = false;
      const checkpointService = {
        createCheckpoint: async () => ({ created: true, message: "test", timestamp: "test" }),
        dropCheckpoint: async () => { checkpointDropped = true; return { dropped: true }; },
        restoreCheckpoint: async () => ({ restored: true }),
      };

      const testRunner = createMockTestRunner([{
        passed: true, exitCode: 0, stdout: "ok", stderr: "",
        durationMs: 100, truncated: false, timedOut: false,
        summary: { total: 5, passed: 5, failed: 0, skipped: 0 },
      }]);

      const loop = createAgenticLoopWithMutations([{
        text: "Made changes", toolResults: [], iterations: 1, aborted: false,
      }]);

      const service = new SelfHealService({
        gitCheckpointService: checkpointService,
        testRunnerService: testRunner,
      });

      const result = await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(result.selfHeal.checkpointCreated, true);
      assert.equal(result.selfHeal.testsPassed, true);
      assert.equal(result.selfHeal.rolledBack, false);
      assert.equal(result.selfHeal.selfHealAttempts, 0);
      assert.equal(checkpointDropped, true);
    });

    it("should skip testing when no mutations occurred", async () => {
      const testRunner = createMockTestRunner([]);
      let testsCalled = false;
      testRunner.runTests = async () => { testsCalled = true; return { passed: true }; };

      const loop = createAgenticLoopWithMutations(
        [{ text: "Read files only", toolResults: [], iterations: 1, aborted: false }],
        { triggerMutations: false }
      );

      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: testRunner,
      });

      const result = await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(testsCalled, false);
      assert.equal(result.selfHeal.testsPassed, null);
    });

    it("should skip testing when no test command configured", async () => {
      const testRunner = createMockTestRunner([]);
      let testsCalled = false;
      testRunner.runTests = async () => { testsCalled = true; return { passed: true }; };

      const loop = createAgenticLoopWithMutations([{
        text: "Made changes", toolResults: [], iterations: 1, aborted: false,
      }]);

      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: testRunner,
      });

      const result = await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: null,
      });

      assert.equal(testsCalled, false);
      assert.equal(result.selfHeal.testsPassed, null);
    });
  });

  describe("run — self-heal retry", () => {
    it("should retry and succeed on second attempt", async () => {
      const testRunner = createMockTestRunner([
        // First run: fail
        {
          passed: false, exitCode: 1, stdout: "FAIL test.js", stderr: "",
          durationMs: 200, truncated: false, timedOut: false,
          summary: { total: 5, passed: 3, failed: 2, skipped: 0 },
        },
        // Second run (after fix): pass
        {
          passed: true, exitCode: 0, stdout: "All passed", stderr: "",
          durationMs: 100, truncated: false, timedOut: false,
          summary: { total: 5, passed: 5, failed: 0, skipped: 0 },
        },
      ]);

      let checkpointDropped = false;
      const checkpointService = {
        createCheckpoint: async () => ({ created: true, message: "test", timestamp: "test" }),
        dropCheckpoint: async () => { checkpointDropped = true; return { dropped: true }; },
        restoreCheckpoint: async () => ({ restored: true }),
      };

      const loop = createAgenticLoopWithMutations([
        { text: "Initial changes", toolResults: [], iterations: 1, aborted: false },
        { text: "Fixed the issues", toolResults: [], iterations: 1, aborted: false },
      ]);

      const service = new SelfHealService({
        gitCheckpointService: checkpointService,
        testRunnerService: testRunner,
      });

      const result = await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(result.selfHeal.testsPassed, true);
      assert.equal(result.selfHeal.selfHealAttempts, 1);
      assert.equal(result.selfHeal.rolledBack, false);
      assert.equal(checkpointDropped, true);
      assert.equal(result.selfHeal.testResults.length, 2);
    });

    it("should rollback after exhausting max retries", async () => {
      const failResult = {
        passed: false, exitCode: 1, stdout: "FAIL", stderr: "",
        durationMs: 100, truncated: false, timedOut: false,
        summary: { total: 5, passed: 0, failed: 5, skipped: 0 },
      };

      const testRunner = createMockTestRunner([
        failResult, failResult, failResult, failResult, // initial + 3 retries
      ]);

      let rolledBack = false;
      const checkpointService = {
        createCheckpoint: async () => ({ created: true, message: "test", timestamp: "test" }),
        dropCheckpoint: async () => ({ dropped: true }),
        restoreCheckpoint: async () => { rolledBack = true; return { restored: true, message: "Restored" }; },
      };

      const loop = createAgenticLoopWithMutations([
        { text: "Changes", toolResults: [], iterations: 1, aborted: false },
        { text: "Fix attempt 1", toolResults: [], iterations: 1, aborted: false },
        { text: "Fix attempt 2", toolResults: [], iterations: 1, aborted: false },
        { text: "Fix attempt 3", toolResults: [], iterations: 1, aborted: false },
      ]);

      const service = new SelfHealService({
        gitCheckpointService: checkpointService,
        testRunnerService: testRunner,
        maxRetries: 3,
      });

      const result = await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(result.selfHeal.testsPassed, false);
      assert.equal(result.selfHeal.selfHealAttempts, 3);
      assert.equal(result.selfHeal.rolledBack, true);
      assert.equal(rolledBack, true);
      // Initial test + 3 retry tests = 4 total
      assert.equal(result.selfHeal.testResults.length, 4);
    });
  });

  describe("run — edge cases", () => {
    it("should handle aborted agentic loop", async () => {
      const loop = createAgenticLoopWithMutations([{
        text: "", toolResults: [], iterations: 1, aborted: true,
      }], { triggerMutations: false });

      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: createMockTestRunner([]),
      });

      const result = await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(result.aborted, true);
      assert.equal(result.selfHeal.testsPassed, null);
    });

    it("should handle checkpoint creation failure", async () => {
      const checkpointService = {
        createCheckpoint: async () => ({ created: false, message: "No uncommitted changes." }),
        dropCheckpoint: async () => ({ dropped: true }),
        restoreCheckpoint: async () => ({ restored: true }),
      };

      const testRunner = createMockTestRunner([{
        passed: true, exitCode: 0, stdout: "ok", stderr: "",
        durationMs: 100, truncated: false, timedOut: false, summary: null,
      }]);

      const loop = createAgenticLoopWithMutations([{
        text: "Done", toolResults: [], iterations: 1, aborted: false,
      }]);

      const service = new SelfHealService({
        gitCheckpointService: checkpointService,
        testRunnerService: testRunner,
      });

      const result = await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(result.selfHeal.checkpointCreated, false);
      // Tests still run even without checkpoint
      assert.equal(result.selfHeal.testsPassed, true);
    });

    it("should call lifecycle hooks", async () => {
      const hooks = {
        checkpointCreated: false,
        testStarted: false,
        testResultReceived: false,
      };

      const testRunner = createMockTestRunner([{
        passed: true, exitCode: 0, stdout: "ok", stderr: "",
        durationMs: 100, truncated: false, timedOut: false, summary: null,
      }]);

      const loop = createAgenticLoopWithMutations([{
        text: "Done", toolResults: [], iterations: 1, aborted: false,
      }]);

      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: testRunner,
        onCheckpointCreated: () => { hooks.checkpointCreated = true; },
        onTestStart: () => { hooks.testStarted = true; },
        onTestResult: () => { hooks.testResultReceived = true; },
      });

      await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(hooks.checkpointCreated, true);
      assert.equal(hooks.testStarted, true);
      assert.equal(hooks.testResultReceived, true);
    });

    it("should call onRetry hook during retries", async () => {
      const retryAttempts = [];

      const testRunner = createMockTestRunner([
        { passed: false, exitCode: 1, stdout: "fail", stderr: "", durationMs: 100, truncated: false, timedOut: false, summary: null },
        { passed: true, exitCode: 0, stdout: "ok", stderr: "", durationMs: 100, truncated: false, timedOut: false, summary: null },
      ]);

      const loop = createAgenticLoopWithMutations([
        { text: "Initial", toolResults: [], iterations: 1, aborted: false },
        { text: "Fix", toolResults: [], iterations: 1, aborted: false },
      ]);

      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: testRunner,
        onRetry: (attempt, max) => { retryAttempts.push({ attempt, max }); },
      });

      await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(retryAttempts.length, 1);
      assert.equal(retryAttempts[0].attempt, 1);
    });

    it("should call onRollback hook when rolling back", async () => {
      let rollbackCalled = false;

      const failResult = {
        passed: false, exitCode: 1, stdout: "fail", stderr: "",
        durationMs: 100, truncated: false, timedOut: false, summary: null,
      };

      const testRunner = createMockTestRunner([failResult, failResult]);

      const loop = createAgenticLoopWithMutations([
        { text: "Initial", toolResults: [], iterations: 1, aborted: false },
        { text: "Fix", toolResults: [], iterations: 1, aborted: false },
      ]);

      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: testRunner,
        maxRetries: 1,
        onRollback: () => { rollbackCalled = true; },
      });

      await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: "npm test",
      });

      assert.equal(rollbackCalled, true);
    });

    it("should restore original onAfterIteration hook", async () => {
      const originalHook = () => "original";
      const loop = createAgenticLoopWithMutations([{
        text: "Done", toolResults: [], iterations: 1, aborted: false,
      }], { triggerMutations: false });
      loop.onAfterIteration = originalHook;

      const service = new SelfHealService({
        gitCheckpointService: createMockCheckpointService(),
        testRunnerService: createMockTestRunner(),
      });

      await service.run({
        agenticLoop: loop,
        runOptions: { messages: [] },
        cwd: "/project",
        testCommand: null,
      });

      // Hook should be restored after run completes
      assert.equal(loop.onAfterIteration, originalHook);
    });
  });

  describe("exports", () => {
    it("should export DEFAULT_MAX_RETRIES", () => {
      assert.equal(DEFAULT_MAX_RETRIES, 3);
    });
  });
});
