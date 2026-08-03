import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PermissionPrompt, PERMISSION_RESPONSE } from "../src/renderers/permission-prompt.js";

function createMockStdout() {
  const chunks = [];
  return {
    chunks,
    isTTY: true,
    columns: 80,
    write(data) {
      chunks.push(data);
      return true;
    },
    get output() {
      return chunks.join("");
    },
    clear() {
      chunks.length = 0;
    },
  };
}

function createMockStdin({ response = "y" } = {}) {
  const listeners = new Map();
  return {
    isTTY: true,
    setRawMode() {},
    resume() {},
    pause() {},
    removeListener(event, fn) {
      const fns = listeners.get(event) || [];
      listeners.set(event, fns.filter((f) => f !== fn));
    },
    once(event, fn) {
      // Auto-respond after a microtask
      queueMicrotask(() => fn(Buffer.from(response)));
    },
    on(event, fn) {
      const fns = listeners.get(event) || [];
      fns.push(fn);
      listeners.set(event, fns);
    },
  };
}

describe("PermissionPrompt", () => {
  let stdout;

  beforeEach(() => {
    stdout = createMockStdout();
  });

  describe("PERMISSION_RESPONSE constants", () => {
    it("defines all expected values", () => {
      assert.equal(PERMISSION_RESPONSE.ALLOW, "allow");
      assert.equal(PERMISSION_RESPONSE.DENY, "deny");
      assert.equal(PERMISSION_RESPONSE.ALLOW_ALL, "allow_all");
      assert.equal(PERMISSION_RESPONSE.EXPLAIN, "explain");
    });
  });

  describe("autoApprove mode", () => {
    it("returns ALLOW immediately when autoApprove is true", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin(),
        stdout,
        autoApprove: true,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit src/index.js",
      });

      assert.equal(result, PERMISSION_RESPONSE.ALLOW);
    });
  });

  describe("non-TTY mode", () => {
    it("returns DENY by default when not TTY", async () => {
      const nonTTYStdin = { ...createMockStdin(), isTTY: false };
      const nonTTYStdout = { ...createMockStdout(), isTTY: false };

      const prompt = new PermissionPrompt({
        stdin: nonTTYStdin,
        stdout: nonTTYStdout,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit file",
        defaultAllow: false,
      });

      assert.equal(result, PERMISSION_RESPONSE.DENY);
    });

    it("returns ALLOW when defaultAllow is true in non-TTY", async () => {
      const nonTTYStdin = { ...createMockStdin(), isTTY: false };
      const nonTTYStdout = { ...createMockStdout(), isTTY: false };

      const prompt = new PermissionPrompt({
        stdin: nonTTYStdin,
        stdout: nonTTYStdout,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.requestPermission({
        toolType: "read_file",
        description: "Read file",
        defaultAllow: true,
      });

      assert.equal(result, PERMISSION_RESPONSE.ALLOW);
    });
  });

  describe("session allow-all tracking", () => {
    it("isAllowedAll returns false by default", () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin(),
        stdout,
        env: { NO_COLOR: "1" },
      });

      assert.equal(prompt.isAllowedAll("write_file"), false);
    });

    it("auto-allows after allow-all response for same tool type", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "a" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      const first = await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit file 1",
      });
      assert.equal(first, PERMISSION_RESPONSE.ALLOW_ALL);
      assert.ok(prompt.isAllowedAll("write_file"));

      // Second request should auto-allow without prompting
      const second = await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit file 2",
      });
      assert.equal(second, PERMISSION_RESPONSE.ALLOW);
    });

    it("does not auto-allow different tool types", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "a" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit file",
      });

      assert.ok(prompt.isAllowedAll("write_file"));
      assert.ok(!prompt.isAllowedAll("execute_command"));
    });

    it("resetAllowAll clears all grants", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "a" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit file",
      });

      prompt.resetAllowAll();
      assert.ok(!prompt.isAllowedAll("write_file"));
    });
  });

  describe("requestPermission rendering", () => {
    it("renders a permission box with description", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "y" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      await prompt.requestPermission({
        toolType: "write_file",
        description: "Fortify wants to edit src/auth.js",
      });

      assert.ok(stdout.output.includes("Permission Request"), "Should include title");
      assert.ok(stdout.output.includes("Fortify wants to edit src/auth.js"), "Should include description");
    });

    it("renders detail when provided", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "y" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit src/auth.js",
        detail: "Changes: +12 -3 lines",
      });

      assert.ok(stdout.output.includes("Changes: +12 -3 lines"), "Should include detail");
    });

    it("handles 'y' response as ALLOW", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "y" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit file",
      });

      assert.equal(result, PERMISSION_RESPONSE.ALLOW);
    });

    it("handles 'n' response as DENY", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "n" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.requestPermission({
        toolType: "write_file",
        description: "Edit file",
      });

      assert.equal(result, PERMISSION_RESPONSE.DENY);
    });

    it("handles '?' response as EXPLAIN", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "?" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.requestPermission({
        toolType: "execute_command",
        description: "Run command",
      });

      assert.equal(result, PERMISSION_RESPONSE.EXPLAIN);
    });
  });

  describe("confirmAction", () => {
    it("returns true for 'y' response", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "y" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.confirmAction({
        description: "Allow updating file?",
      });

      assert.equal(result, true);
    });

    it("returns false for 'n' response", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "n" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.confirmAction({
        description: "Allow updating file?",
      });

      assert.equal(result, false);
    });

    it("returns defaultAllow for empty response", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin({ response: "" }),
        stdout,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.confirmAction({
        description: "Allow?",
        defaultAllow: true,
      });

      assert.equal(result, true);
    });

    it("auto-approves when autoApprove is set", async () => {
      const prompt = new PermissionPrompt({
        stdin: createMockStdin(),
        stdout,
        autoApprove: true,
        env: { NO_COLOR: "1" },
      });

      const result = await prompt.confirmAction({
        description: "Something dangerous",
      });

      assert.equal(result, true);
    });
  });
});
