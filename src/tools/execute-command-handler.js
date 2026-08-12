import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Default timeout for command execution (30 seconds).
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Maximum combined stdout + stderr size (50KB).
 */
const MAX_OUTPUT_BYTES = 51_200;

/**
 * execute_command tool handler.
 *
 * Runs a shell command in the workspace and captures output.
 * Integrates with CommandAllowlist for security validation.
 *
 * @param {object} params - Tool parameters from the LLM
 * @param {string} params.command - Shell command to execute
 * @param {string} [params.cwd] - Working directory (relative to project root)
 * @param {object} context - Execution context
 * @param {string} context.cwd - Project root directory
 * @param {import("../config/command-allowlist.js").CommandAllowlist} [context.commandAllowlist] - Security allowlist
 * @param {number} [context.timeoutMs] - Override timeout
 * @param {object} [context.spawnFn] - Spawn function (for testing)
 * @returns {Promise<{ output: string }>}
 */
export async function executeCommandHandler(params, context) {
  const { command, cwd: workDir } = params;
  const {
    cwd = process.cwd(),
    commandAllowlist,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    spawnFn = spawn,
  } = context;

  // 1. Validate command
  if (!command || typeof command !== "string" || !command.trim()) {
    return { output: "[Error] Command is required." };
  }

  const trimmedCommand = command.trim();

  // 2. Security: check allowlist
  if (commandAllowlist) {
    const validation = commandAllowlist.validate(trimmedCommand);

    if (!validation.allowed) {
      return {
        output: `[Blocked] ${validation.reason}`,
      };
    }

    // Include warnings in output if any
    if (validation.warnings.length > 0) {
      // Warnings are informational — command still runs
    }
  }

  // 3. Resolve working directory
  let execCwd = cwd;
  if (workDir && typeof workDir === "string" && workDir.trim()) {
    execCwd = path.resolve(cwd, workDir.trim());

    // Security: ensure working directory is within project root
    const normalizedCwd = path.resolve(cwd);
    if (!execCwd.startsWith(normalizedCwd)) {
      return {
        output: `[Error] Working directory '${workDir}' resolves outside the project root.`,
      };
    }
  }

  // 4. Determine shell and args based on platform
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "cmd.exe" : "/bin/sh";
  const shellArgs = isWindows ? ["/c", trimmedCommand] : ["-c", trimmedCommand];

  // 5. Execute command
  try {
    const result = await runProcess(shell, shellArgs, {
      cwd: execCwd,
      timeoutMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      spawnFn,
    });

    // 6. Build output
    let output = "";

    if (result.stdout) {
      output += result.stdout;
    }

    if (result.stderr) {
      if (output) output += "\n";
      output += `[stderr]\n${result.stderr}`;
    }

    if (!output.trim()) {
      output = "(no output)";
    }

    // Truncation notice
    if (result.truncated) {
      output += `\n[Truncated] Output exceeded ${Math.round(MAX_OUTPUT_BYTES / 1024)}KB limit.`;
    }

    // Exit code
    if (result.exitCode !== 0) {
      output += `\n[Exit code: ${result.exitCode}]`;
    }

    if (result.timedOut) {
      output += `\n[Timed out after ${Math.round(timeoutMs / 1000)}s]`;
    }

    return { output };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        output: `[Error] Command not found: '${trimmedCommand.split(/\s+/)[0]}'`,
      };
    }

    return {
      output: `[Error] Failed to execute command: ${error.message}`,
    };
  }
}

/**
 * Run a process and capture output with timeout and size limits.
 *
 * @param {string} command - Command/shell to run
 * @param {string[]} args - Arguments
 * @param {object} options
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, truncated: boolean, timedOut: boolean }>}
 */
function runProcess(command, args, { cwd, timeoutMs, maxOutputBytes, spawnFn }) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawnFn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    // Timeout
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
        // Force kill after 2 seconds if still alive
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already dead */ }
        }, 2000);
      } catch { /* already dead */ }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      if (stdout.length + stderr.length < maxOutputBytes) {
        stdout += chunk;
      } else {
        truncated = true;
      }
    });

    child.stderr.on("data", (chunk) => {
      if (stdout.length + stderr.length < maxOutputBytes) {
        stderr += chunk;
      } else {
        truncated = true;
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode ?? 1,
          truncated,
          timedOut,
        });
      }
    });
  });
}

// Export for testing
export { DEFAULT_TIMEOUT_MS, MAX_OUTPUT_BYTES };
