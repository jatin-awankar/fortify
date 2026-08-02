import { createActionCardRenderer, ACTION_TYPES } from "../src/renderers/action-card-renderer.js";
import { createTerminalUI } from "../src/renderers/terminal-ui.js";

const terminalUI = createTerminalUI();
const renderer = createActionCardRenderer({ terminalUI });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runLiveDemo() {
  console.log("\n=== Fortify Phase 1: Action Cards Animated Demo ===\n");

  // Step 1
  renderer.renderStepProgress(1, 3, "Discovering workspace structure...");
  await delay(600);

  // Step 2: Live In-Place Line Updating
  renderer.renderCard({
    type: ACTION_TYPES.READ_FILE,
    title: "Reading src/index.js...",
    status: "running"
  });

  await delay(1000);

  // Replaces the exact line above in-place!
  renderer.updateLastCard({
    type: ACTION_TYPES.READ_FILE,
    title: "Read src/index.js",
    metadata: "32 lines",
    status: "success"
  });

  await delay(600);

  // Step 3: Thinking -> Success
  renderer.renderCard({
    type: ACTION_TYPES.THINKING,
    title: "Analyzing exports & dependencies...",
    status: "running"
  });

  await delay(1000);

  renderer.updateLastCard({
    type: ACTION_TYPES.THINKING,
    title: "Analysis complete",
    metadata: "0 dependencies",
    status: "success"
  });

  await delay(600);

  // Command Execution
  renderer.renderCommandCard("npm test", { cwd: "./", status: "running" });
  await delay(800);
  renderer.updateLastCard({
    type: ACTION_TYPES.EXECUTE_COMMAND,
    title: "Run `npm test` (90/90 passed)",
    status: "success"
  });

  console.log("\n=== Animated Demo Complete ===\n");
}

runLiveDemo();
