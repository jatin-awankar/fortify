const MAX_CONTEXT_CHARS = 14_000;
const MAX_STACK_FRAMES = 16;

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[Truncated ${omitted} characters for brevity]`;
}

function serializeStackTraceSummary(stackTrace) {
  if (!stackTrace?.detected) {
    return "No clear Node.js stack trace pattern detected.";
  }

  const frameLines = stackTrace.frames
    .slice(0, MAX_STACK_FRAMES)
    .map((frame, index) => `${index + 1}. ${frame.raw}`);

  return [
    `Detected header: ${stackTrace.header || "unknown"}`,
    `Detected frames: ${stackTrace.frames.length}`,
    ...frameLines
  ].join("\n");
}

export function buildExplainInstructions({ hasStackTrace }) {
  const stackAwareHint = hasStackTrace
    ? "Prioritize stack-frame-driven diagnosis."
    : "Infer likely failure points from the provided error text.";

  return [
    "You are a senior Node.js debugging assistant.",
    stackAwareHint,
    "Do NOT output internal draft monologues, thought processes, or reasoning lists. Respond ONLY with these final sections:",
    "1) Likely Root Cause",
    "2) Why It Happened",
    "3) Actionable Debug Steps",
    "4) Quick Verification",
    "Use short bullets and practical steps."
  ].join(" ");
}

export function buildExplainInput({
  sourceLabel,
  sourceType,
  rawErrorText,
  additionalContext,
  stackTrace
}) {
  const conciseErrorContext = truncateText(rawErrorText, MAX_CONTEXT_CHARS);

  return [
    `Input source: ${sourceType} (${sourceLabel})`,
    `Additional context: ${additionalContext || "none"}`,
    "Stack trace analysis:",
    serializeStackTraceSummary(stackTrace),
    "Error text:",
    conciseErrorContext
  ].join("\n");
}
