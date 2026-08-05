const NODE_STACK_FRAME_PATTERN =
  /^\s*at\s+(?:[^\s(]+[\s]+)?(?:file:\/\/\/)?((?:[a-zA-Z]:[\\/])?[^():\n]+):(\d+):(\d+)\)?\s*$/m;
const NODE_ERROR_HEADER_PATTERN =
  /^(?:Uncaught\s+)?(?:[A-Za-z]*Error|TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|UnhandledPromiseRejection|AggregateError)(?:\s*\[[A-Z0-9_]+\])?:\s*.+/m;

export function detectNodeStackTrace(text) {
  if (typeof text !== "string" || !text.trim()) {
    return {
      detected: false,
      header: "",
      frames: []
    };
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const frames = [];
  let header = "";

  for (const line of lines) {
    if (!header && NODE_ERROR_HEADER_PATTERN.test(line)) {
      header = line.trim();
    }

    const match = line.match(NODE_STACK_FRAME_PATTERN);
    if (match) {
      frames.push({
        raw: line.trim(),
        filePath: match[1],
        line: Number(match[2]),
        column: Number(match[3])
      });
    }
  }

  const detected = Boolean(header || frames.length >= 2);
  return {
    detected,
    header,
    frames
  };
}
