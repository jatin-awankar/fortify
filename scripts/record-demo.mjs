import { createTUISession } from "../src/renderers/tui-session.js";
import { createActionCardRenderer, ACTION_TYPES } from "../src/renderers/action-card-renderer.js";
import { createDiffRenderer } from "../src/renderers/diff-renderer.js";
import { createTerminalUI } from "../src/renderers/terminal-ui.js";

const terminalUI = createTerminalUI();
const tuiSession = createTUISession({ terminalUI });
const actionCardRenderer = createActionCardRenderer({ terminalUI });
const diffRenderer = createDiffRenderer({ terminalUI });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function typeText(text, msPerChar = 30) {
  for (const char of text) {
    process.stdout.write(terminalUI.chalk.bold.cyan(char));
    await delay(msPerChar);
  }
  process.stdout.write("\n");
}

async function runShowcaseRecording() {
  console.clear();
  console.log("\n");

  // 1. Session Header
  tuiSession.renderHeader({
    model: "gpt-4o",
    provider: "openai",
    cwd: process.cwd(),
    sessionId: "sess-8f92a"
  });

  tuiSession.renderHelpFooter();
  terminalUI.divider();
  await delay(800);

  // 2. Simulated Typing
  process.stdout.write(terminalUI.chalk.bold.cyan("You > "));
  await typeText("Add exponential backoff retry logic to @src/services/chat-service.js", 25);
  console.log("");
  await delay(600);

  // 3. Action Cards
  actionCardRenderer.renderStepProgress(1, 3, "Discovering workspace structure & signature...");
  await delay(600);

  actionCardRenderer.renderCard({
    type: ACTION_TYPES.READ_FILE,
    title: "Reading src/services/chat-service.js...",
    status: "running"
  });
  await delay(1000);

  actionCardRenderer.updateLastCard({
    type: ACTION_TYPES.READ_FILE,
    title: "Read src/services/chat-service.js",
    metadata: "128 lines",
    status: "success"
  });
  await delay(800);

  // 4. Real Code Diff Card
  actionCardRenderer.renderStepProgress(2, 3, "Generating code refactor diff...");
  await delay(600);

  const realCodeDiff = `@@ -42,4 +42,8 @@
-const response = await fetch(endpoint, options);
+const response = await withExponentialBackoff(async () => {
+  return await fetch(endpoint, options);
+}, { maxRetries: 3, baseDelayMs: 500 });`;

  diffRenderer.renderDiffCard("src/services/chat-service.js", realCodeDiff);
  await delay(900);

  // 5. Interactive Confirmation
  actionCardRenderer.renderStepProgress(3, 3, "Awaiting approval for file modification...");
  await delay(500);

  process.stdout.write(`  ${terminalUI.chalk.yellow("?")} Allow updating src/services/chat-service.js with diff above? ${terminalUI.chalk.dim("[Y/n]")} `);
  await delay(400);
  await typeText("y", 100);
  await delay(400);

  actionCardRenderer.renderCard({
    type: ACTION_TYPES.WRITE_FILE,
    title: "Updated src/services/chat-service.js",
    metadata: "+4 lines, -1 line",
    status: "success"
  });

  console.log("\n" + terminalUI.chalk.bold.green("Assistant:") + " Implemented exponential backoff retries with automatic 500ms base delay and 3 retries on HTTP 429/5xx errors!\n");
  terminalUI.divider();
  console.log("\n=== Showcase Recording Script Complete ===\n");
}

runShowcaseRecording();
