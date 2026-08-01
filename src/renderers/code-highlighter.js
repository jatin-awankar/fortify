const KEYWORD_PATTERN =
  /\b(const|let|var|function|class|if|else|return|import|from|export|default|await|async|new|try|catch|throw|switch|case|break|continue|for|while|do|extends|implements|interface|type)\b/g;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/g;
const STRING_PATTERN = /(["'`])(?:\\.|(?!\1).)*\1/g;

function applyRegexColor(text, pattern, colorFn) {
  return text.replace(pattern, (match) => colorFn(match));
}

export function highlightCodeLine(line, { language = "", chalk } = {}) {
  if (typeof line !== "string" || !line.length) {
    return "";
  }

  if (!chalk) {
    return line;
  }

  const trimmedLanguage = language.trim().toLowerCase();

  if (trimmedLanguage === "diff") {
    if (line.startsWith("+")) {
      return chalk.green(line);
    }
    if (line.startsWith("-")) {
      return chalk.red(line);
    }
    if (line.startsWith("@@")) {
      return chalk.cyan(line);
    }
    return chalk.gray(line);
  }

  const supportsKeywordHighlight = [
    "js",
    "javascript",
    "ts",
    "typescript",
    "mjs",
    "cjs",
    "jsx",
    "tsx",
    "node"
  ].includes(trimmedLanguage);

  if (supportsKeywordHighlight) {
    const commentIdx = line.indexOf("//");
    let codePart = line;
    let commentPart = "";
    if (commentIdx >= 0) {
      const beforeComment = line.slice(0, commentIdx);
      const singleQuotes = (beforeComment.match(/'/g) || []).length;
      const doubleQuotes = (beforeComment.match(/"/g) || []).length;
      if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
        codePart = line.slice(0, commentIdx);
        commentPart = line.slice(commentIdx);
      }
    }

    let output = applyRegexColor(codePart, STRING_PATTERN, chalk.green);
    output = applyRegexColor(output, NUMBER_PATTERN, chalk.magentaBright);
    output = applyRegexColor(output, KEYWORD_PATTERN, chalk.cyanBright);

    if (commentPart) {
      output += chalk.gray(commentPart);
    }

    return output;
  }

  return chalk.white(line);
}
