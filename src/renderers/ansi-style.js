import { styleText } from "node:util";

export function createAnsiStyle({ env = process.env, forceColor = null } = {}) {
  const noColor = Boolean(env.NO_COLOR && env.NO_COLOR !== "0");
  const force = forceColor !== null ? forceColor : (env.FORCE_COLOR ? env.FORCE_COLOR !== "0" : null);

  const shouldUseColor = force !== null ? force : (!noColor && Boolean(process.stdout?.isTTY));

  function wrap(format, text) {
    if (!shouldUseColor || !text) return String(text ?? "");
    try {
      return styleText(format, String(text));
    } catch {
      return String(text);
    }
  }

  function styleFn(format) {
    const fn = (text) => wrap(format, text);
    return fn;
  }

  const baseStyle = (text) => String(text ?? "");

  baseStyle.cyan = styleFn("cyan");
  baseStyle.green = styleFn("green");
  baseStyle.yellow = styleFn("yellow");
  baseStyle.red = styleFn("red");
  baseStyle.gray = styleFn("gray");
  baseStyle.magenta = styleFn("magenta");
  baseStyle.blue = styleFn("blue");
  baseStyle.white = styleFn("white");
  baseStyle.bold = styleFn("bold");
  baseStyle.dim = styleFn("dim");
  baseStyle.italic = styleFn("italic");
  baseStyle.underline = styleFn("underline");

  baseStyle.magentaBright = styleFn("magenta");
  baseStyle.cyanBright = styleFn("cyan");
  baseStyle.greenBright = styleFn("green");
  baseStyle.redBright = styleFn("red");
  baseStyle.yellowBright = styleFn("yellow");
  baseStyle.whiteBright = styleFn("white");

  baseStyle.bold.cyan = (text) => wrap(["bold", "cyan"], text);
  baseStyle.bold.green = (text) => wrap(["bold", "green"], text);
  baseStyle.bold.yellow = (text) => wrap(["bold", "yellow"], text);
  baseStyle.bold.red = (text) => wrap(["bold", "red"], text);

  return baseStyle;
}
