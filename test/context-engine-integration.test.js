import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { ProjectContextService } from "../src/services/project-context-service.js";
import { GitService } from "../src/services/git-service.js";
import { MemoryService } from "../src/services/memory-service.js";
import { RepoMapService } from "../src/services/repo-map-service.js";
import { buildAgenticSystemPrompt } from "../src/config/agentic-system-prompt.js";

// Helper to run raw git commands
import { spawn } from "node:child_process";
const execGit = (args, cwd) => new Promise((resolve, reject) => {
  const child = spawn("git", args, { cwd });
  let out = "";
  child.stdout.on("data", b => out += b);
  child.stderr.on("data", b => out += b);
  child.on("close", code => code === 0 ? resolve(out) : reject(new Error(`Git ${args.join(" ")} failed: ${out}`)));
});

describe("Integration: Intelligent Context Engine (Phase 2)", () => {
  let tmpDir;
  let gitService;
  let pcs;
  let repoMapService;
  let memoryService;

  before(async () => {
    // 1. Setup a real temporary project directory
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fortify-context-test-"));
    
    // 2. Initialize Git and add some files
    await execGit(["init"], tmpDir);
    await execGit(["config", "user.email", "test@example.com"], tmpDir);
    await execGit(["config", "user.name", "Test User"], tmpDir);
    
    // Source file with a symbol
    const srcContent = `
/**
 * @function testFunction
 */
export function testFunction() { return true; }
`;
    await fs.mkdir(path.join(tmpDir, "src"));
    await fs.writeFile(path.join(tmpDir, "src", "index.js"), srcContent);
    
    // Package.json to detect stack
    await fs.writeFile(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-pkg" }));

    // Commit to make it a tracked repo
    await execGit(["add", "."], tmpDir);
    await execGit(["commit", "-m", "Initial commit"], tmpDir);

    // 3. Setup Project Config (.fortify/project.json)
    const fortifyDir = path.join(tmpDir, ".fortify");
    await fs.mkdir(fortifyDir);
    await fs.writeFile(path.join(fortifyDir, "project.json"), JSON.stringify({
      name: "Integration Test Project",
      instructions: "Never use var. Always use const."
    }));

    // 4. Initialize Services
    gitService = new GitService({ cwd: tmpDir });
    pcs = new ProjectContextService({ cwd: tmpDir, gitService });
    repoMapService = new RepoMapService({ gitService });
    memoryService = new MemoryService();

    // 5. Add persistent memory
    await memoryService.appendMemory(tmpDir, "User prefers functional programming patterns.");
  });

  after(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("assembles a full agentic prompt combining all context sources", async () => {
    // A. Fetch Project Context
    const summary = await pcs.getProjectContextSummary();
    assert.equal(summary.name, "Integration Test Project");
    assert.ok(summary.stack.includes("Node.js")); // Detected from package.json
    assert.equal(summary.instructions, "Never use var. Always use const.");
    assert.equal(summary.hasMemory, true); // Detected from .fortify/memory.md
    
    const basePrompt = pcs.formatSystemPromptContext(summary);

    // B. Generate Repo Map
    const mapData = await repoMapService.generateRepoMap({ cwd: tmpDir, includeSymbols: true });
    const repoMap = repoMapService.formatForPrompt(mapData);

    // C. Load Memory
    const memoryText = await memoryService.loadMemory(tmpDir);
    const formattedMemory = memoryService.formatForPrompt(memoryText);

    // D. Build Agentic Prompt
    const fullPrompt = buildAgenticSystemPrompt({
      basePrompt,
      toolSummary: "- read_file\n- execute_command",
      cwd: tmpDir,
      repoMap,
      memory: formattedMemory
    });

    // ──────────────────────────────────────────────
    // Verification of the assembled context
    // ──────────────────────────────────────────────

    // 1. Identity & Agentic Mode
    assert.ok(fullPrompt.includes("You are Fortify"), "Missing identity");
    assert.ok(fullPrompt.includes("[Agentic Mode]"), "Missing agentic guidelines");
    
    // 2. Working Directory
    assert.ok(fullPrompt.includes(`Working Directory: ${tmpDir}`), "Missing CWD");
    
    // 3. Project Context
    assert.ok(fullPrompt.includes("[Project Context]"), "Missing Project Context header");
    assert.ok(fullPrompt.includes("Name: Integration Test Project"), "Missing project name");
    assert.ok(fullPrompt.includes("Stack: Node.js"), "Missing detected stack");
    assert.ok(fullPrompt.includes("Custom Guidelines/Memory: Never use var"), "Missing project.json instructions");
    assert.ok(fullPrompt.includes("Initial commit"), "Missing git commit history");
    
    // 4. Repo Map
    assert.ok(fullPrompt.includes("[Repository Map]"), "Missing Repo Map header");
    assert.ok(fullPrompt.includes("src/"), "Missing src/ dir in repo map");
    assert.ok(fullPrompt.includes("index.js"), "Missing index.js in repo map");
    assert.ok(fullPrompt.includes("testFunction"), "Missing extracted symbol in repo map");
    
    // 5. Persistent Memory
    assert.ok(fullPrompt.includes("[Project Memory]"), "Missing Project Memory header");
    assert.ok(fullPrompt.includes("User prefers functional programming patterns"), "Missing appended memory entry");
    assert.ok(fullPrompt.match(/## \d{4}-\d{2}-\d{2} \d{2}:\d{2}/), "Missing memory timestamp header");

    // 6. Tools
    assert.ok(fullPrompt.includes("- read_file"), "Missing tool summary");
  });
});
