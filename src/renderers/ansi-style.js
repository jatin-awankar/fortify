import { styleText } from "node:util";

export function createAnsiStyle({ env = process.env, forceColor = null } = {}) {
  const noColor = Boolean(env.NO_COLOR && env.NO_COLOR !== "0");
  const force = forceColor !== null ? forceColor : (env.FORCE_COLOR ? env.FORCE_COLOR !== "0" : null);

  const shouldUseColor = force !== null ? force : (!noColor && Boolean(process.stdout?.isTTY));

  const proxyCache = new Map();

  function createChainer(formats = []) {
    const key = formats.join(".");
    if (proxyCache.has(key)) {
      return proxyCache.get(key);
    }

    const fn = (text) => {
      if (text === undefined || text === null) return "";
      const strText = String(text);
      if (!shouldUseColor || !strText || formats.length === 0) return strText;

      try {
        const validFormats = formats
          .map((f) => {
            if (f === "cyanBright") return "cyan";
            if (f === "greenBright") return "green";
            if (f === "redBright") return "red";
            if (f === "yellowBright") return "yellow";
            if (f === "magentaBright") return "magenta";
            if (f === "whiteBright") return "white";
            if (f === "blueBright") return "blue";
            if (f === "bgBlackBright") return "gray";
            return f;
          })
          .filter(Boolean);

        return styleText(validFormats, strText);
      } catch {
        return strText;
      }
    };

    const proxy = new Proxy(fn, {
      get(target, prop) {
        if (prop === "shouldUseColor") return shouldUseColor;
        if (prop in target) return target[prop];
        if (typeof prop === "string") {
          return createChainer([...formats, prop]);
        }
        return target[prop];
      }
    });

    proxyCache.set(key, proxy);
    return proxy;
  }

  return createChainer([]);
}

/**
 * Strip ANSI escape sequences from a string to get visible text length.
 * Matches: CSI sequences, OSC sequences, and simple ESC sequences.
 */
export function stripAnsi(text) {
  if (typeof text !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[^[\]]/g, "");
}

/**
 * Calculate the visible width of a string (excluding ANSI escape codes).
 */
export function visibleWidth(text) {
  return stripAnsi(text).length;
}

/** ANSI escape sequences for cursor and screen control. */
export const ANSI = {
  cursorHide: "\x1b[?25l",
  cursorShow: "\x1b[?25h",
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  cursorTo: (col) => `\x1b[${col}G`,
  cursorSave: "\x1b[s",
  cursorRestore: "\x1b[u",
  eraseLine: "\x1b[2K",
  eraseDown: "\x1b[J",
  scrollUp: (n = 1) => `\x1b[${n}S`,
  moveTo: (row, col) => `\x1b[${row};${col}H`,
};
