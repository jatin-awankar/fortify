import { PromptEditor } from "../src/renderers/prompt-editor.js";
import { createTerminalUI } from "../src/renderers/terminal-ui.js";

const terminalUI = createTerminalUI();
const promptEditor = new PromptEditor({
  stdin: process.stdin,
  stdout: process.stdout
});

console.log("\n=== Fortify Phase 3: Interactive Prompt & Tab Completion Demo ===");
console.log("💡 Instructions:");
console.log("  • Type '/' and press [TAB] to autocomple slash commands (/commit, /explain, /summary, /help, /exit)");
console.log("  • Type '@' and press [TAB] to autocomplete workspace files (e.g. @src/index.js)");
console.log("  • Type '/exit' or 'exit' to quit this demo\n");

const rl = promptEditor.createInterface();

function promptLoop() {
  rl.question(terminalUI.chalk.bold.cyan("You > "), (answer) => {
    const input = answer.trim();

    if (input === "/exit" || input === "exit") {
      console.log("\nExiting Phase 3 Demo. Goodbye!\n");
      rl.close();
      return;
    }

    if (input.startsWith("/")) {
      console.log(terminalUI.chalk.green(`  ⚡ Executed Slash Command: ${input}`));
    } else if (input.includes("@")) {
      console.log(terminalUI.chalk.cyan(`  📄 Message with attached files: ${input}`));
    } else {
      console.log(terminalUI.chalk.dim(`  💬 User input received: "${input}"`));
    }

    promptLoop();
  });
}

promptLoop();
