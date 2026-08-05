const BACKSPACE_KEYS = new Set(["\u0008", "\u007f"]);
const NEWLINE_KEYS = new Set(["\r", "\n"]);
const CTRL_C = "\u0003";

export async function promptSecretInput({
  prompt = "Enter secret: ",
  mask = "*",
  stdin = process.stdin,
  stdout = process.stdout
} = {}) {
  if (!stdin?.isTTY || !stdout?.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Masked input requires an interactive terminal.");
  }

  const previousRawMode = Boolean(stdin.isRaw);
  let secret = "";

  stdout.write(prompt);

  return new Promise((resolve, reject) => {
    function cleanup() {
      stdin.off("data", onData);
      stdin.pause();
      stdin.setRawMode(previousRawMode);
    }

    function onData(buffer) {
      try {
        let chunk = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
        chunk = chunk.replace(/\u001b\[200~/g, "").replace(/\u001b\[201~/g, "");
        if (chunk.startsWith("\u001b") && chunk.length <= 10) {
          return;
        }

        for (const key of chunk) {
          if (NEWLINE_KEYS.has(key)) {
            stdout.write("\n");
            cleanup();
            resolve(secret);
            return;
          }

          if (key === CTRL_C) {
            stdout.write("\n");
            cleanup();
            reject(new Error("Input cancelled."));
            return;
          }

          if (BACKSPACE_KEYS.has(key)) {
            if (secret.length > 0) {
              secret = secret.slice(0, -1);
              if (mask.length > 0) {
                const backspaces = "\b".repeat(mask.length);
                const spaces = " ".repeat(mask.length);
                stdout.write(`${backspaces}${spaces}${backspaces}`);
              }
            }
            continue;
          }

          secret += key;
          stdout.write(mask);
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
