import { styleText } from "node:util";

export function createAnsiStyle({ env = process.env, forceColor = null } = {}) {
  const noColor = Boolean(env.NO_COLOR && env.NO_COLOR !== "0");
  const force = forceColor !== null ? forceColor : (env.FORCE_COLOR ? env.FORCE_COLOR !== "0" : null);

  const shouldUseColor = force !== null ? force : (!noColor && Boolean(process.stdout?.isTTY));

  function createChainer(formats = []) {
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

    return new Proxy(fn, {
      get(target, prop) {
        if (prop === "shouldUseColor") return shouldUseColor;
        if (prop in target) return target[prop];
        if (typeof prop === "string") {
          return createChainer([...formats, prop]);
        }
        return target[prop];
      }
    });
  }

  return createChainer([]);
}
