import { createTUISession } from "../src/renderers/tui-session.js";
import { createActionCardRenderer, ACTION_TYPES } from "../src/renderers/action-card-renderer.js";
import { createDiffRenderer } from "../src/renderers/diff-renderer.js";
import { createTerminalUI } from "../src/renderers/terminal-ui.js";

const terminalUI = createTerminalUI();
const tuiSession = createTUISession({ terminalUI });
const actionCardRenderer = createActionCardRenderer({ terminalUI });
const diffRenderer = createDiffRenderer({ terminalUI });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runFullTUIDemo() {
  console.log("\n");

  // 1. Render Session Header
  tuiSession.renderHeader({
    model: "gpt-4o",
    provider: "openai",
    cwd: process.cwd(),
    sessionId: "sess-8f92a"
  });

  // 2. Render Help Footer
  tuiSession.renderHelpFooter();
  terminalUI.divider();

  // 3. User prompt & Assistant stream simulation
  console.log(terminalUI.chalk.bold.cyan("You:") + " Optimize the error handling in src/index.js\n");

  actionCardRenderer.renderStepProgress(1, 3, "Analyzing codebase & dependencies...");
  await delay(500);

  actionCardRenderer.renderCard({
    type: ACTION_TYPES.READ_FILE,
    title: "Reading src/index.js",
    metadata: "445 bytes",
    status: "success"
  });

  await delay(400);

  actionCardRenderer.renderStepProgress(2, 3, "Generating diff optimization...");
  await delay(500);

  diffRenderer.renderDiffCard("src/index.js", `@@ -15,4 +15,6 @@
-throw new Error(err);
+if (err.fatal) {
+  process.exit(1);
+}`);

  await delay(400);

  // 4. Interactive Permission Dialog Simulation
  actionCardRenderer.renderStepProgress(3, 3, "Awaiting approval for file modification...");
  
  const allowed = await tuiSession.confirmAction("Allow updating src/index.js with diff above?", true);
  
  if (allowed) {
    actionCardRenderer.renderCard({
      type: ACTION_TYPES.WRITE_FILE,
      title: "Updated src/index.js",
      status: "success"
    });
    console.log("\n" + terminalUI.chalk.bold.green("Assistant:") + " Cleanly updated src/index.js with robust error handling!\n");
  } else {
    actionCardRenderer.renderCard({
      type: ACTION_TYPES.WRITE_FILE,
      title: "File edit skipped by user",
      status: "error"
    });
  }

  terminalUI.divider();
  console.log("=== Full TUI Demo Complete ===\n");
  process.exit(0);
}

runFullTUIDemo();
