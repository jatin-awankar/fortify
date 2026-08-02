import { createDiffRenderer } from "../src/renderers/diff-renderer.js";
import { createTerminalUI } from "../src/renderers/terminal-ui.js";

const terminalUI = createTerminalUI();
const diffRenderer = createDiffRenderer({ terminalUI });

console.log("\n=== Fortify Phase 2: Diff Preview Card Demo ===\n");

const sampleDiff1 = `@@ -12,5 +12,6 @@
-const TIMEOUT_MS = 1000;
+const TIMEOUT_MS = 5000;
 const RETRY_ATTEMPTS = 3;
+const ENABLE_LOGGING = true;`;

diffRenderer.renderDiffCard("src/config/app-metadata.js", sampleDiff1);

console.log("\n");

const sampleDiff2 = `@@ -1,4 +1,4 @@
-export function calculateCost(tokens) { return tokens * 0.001; }
+export function calculateCost(tokens, rate = 0.001) { return tokens * rate; }`;

diffRenderer.renderDiffCard("src/utils/cost-calculator.js", sampleDiff2);

console.log("\n=== Demo Complete ===\n");
