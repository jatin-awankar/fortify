import { stripAnsi, visibleWidth } from "./ansi-style.js";

/**
 * Border character sets for box drawing.
 * "single" uses standard box-drawing chars, "rounded" uses rounded corners.
 */
const BORDER_STYLES = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│", ml: "├", mr: "┤" },
  rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", ml: "├", mr: "┤" },
  heavy:   { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃", ml: "┠", mr: "┨" },
  none:    { tl: " ", tr: " ", bl: " ", br: " ", h: " ", v: " ", ml: " ", mr: " " },
};

const DEFAULT_OPTIONS = {
  borderStyle: "rounded",
  padding: 1,
  margin: 0,
  titleAlignment: "left",
  minWidth: 30,
  maxWidth: 100,
  dimBorder: false,
};

/**
 * Render a bordered box around content lines.
 *
 * @param {object} options
 * @param {string} [options.title] - Title text rendered in the top border
 * @param {string} [options.subtitle] - Subtitle rendered in the bottom border
 * @param {string|string[]} [options.content] - Content lines (string or array)
 * @param {string} [options.borderStyle] - "single", "rounded", "heavy", or "none"
 * @param {number} [options.padding] - Horizontal padding inside the box
 * @param {number} [options.margin] - Left margin (indentation)
 * @param {string} [options.titleAlignment] - "left", "center", or "right"
 * @param {number} [options.minWidth] - Minimum inner width
 * @param {number} [options.maxWidth] - Maximum inner width
 * @param {boolean} [options.dimBorder] - Whether to dim the border characters
 * @param {number} [options.terminalWidth] - Available terminal columns
 * @param {Function} [options.chalk] - ANSI color function (createAnsiStyle result)
 * @returns {string} The rendered box as a string
 */
export function renderBox(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const border = BORDER_STYLES[opts.borderStyle] || BORDER_STYLES.rounded;
  const chalk = opts.chalk;
  const pad = opts.padding;
  const marginStr = " ".repeat(opts.margin);

  // Parse content into lines
  const rawLines = Array.isArray(opts.content)
    ? opts.content
    : typeof opts.content === "string"
      ? opts.content.split("\n")
      : [];

  // Calculate widths
  const titleWidth = opts.title ? visibleWidth(opts.title) : 0;
  const subtitleWidth = opts.subtitle ? visibleWidth(opts.subtitle) : 0;
  const maxContentWidth = rawLines.length > 0
    ? Math.max(...rawLines.map((l) => visibleWidth(l)))
    : 0;

  const termCols = opts.terminalWidth || opts.maxWidth;
  const innerWidth = Math.min(
    Math.max(opts.minWidth, maxContentWidth + pad * 2, titleWidth + 4, subtitleWidth + 4),
    termCols - opts.margin * 2 - 2  // 2 for border chars
  );

  // Styling helpers
  const bc = (char) => {
    if (!chalk) return char;
    return opts.dimBorder ? chalk.dim(char) : chalk.dim(char);
  };

  const titleColor = (text) => {
    if (!chalk) return text;
    return chalk.bold.cyan(text);
  };

  // Build top border with title
  let topBorder;
  if (opts.title) {
    const titleStr = ` ${opts.title} `;
    const titleVisLen = visibleWidth(titleStr) + 2; // +2 for padding spaces in border
    const remaining = Math.max(0, innerWidth - titleVisLen);

    if (opts.titleAlignment === "center") {
      const left = Math.floor(remaining / 2);
      const right = remaining - left;
      topBorder = `${marginStr}${bc(border.tl)}${bc(border.h.repeat(left))} ${titleColor(opts.title)} ${bc(border.h.repeat(right))}${bc(border.tr)}`;
    } else {
      topBorder = `${marginStr}${bc(border.tl)}${bc(border.h)} ${titleColor(opts.title)} ${bc(border.h.repeat(Math.max(0, innerWidth - titleVisLen + 1)))}${bc(border.tr)}`;
    }
  } else {
    topBorder = `${marginStr}${bc(border.tl)}${bc(border.h.repeat(innerWidth))}${bc(border.tr)}`;
  }

  // Build bottom border with optional subtitle
  let bottomBorder;
  if (opts.subtitle) {
    const subStr = ` ${opts.subtitle} `;
    const subVisLen = visibleWidth(subStr) + 2;
    const remaining = Math.max(0, innerWidth - subVisLen);
    bottomBorder = `${marginStr}${bc(border.bl)}${bc(border.h)} ${chalk ? chalk.dim(opts.subtitle) : opts.subtitle} ${bc(border.h.repeat(remaining + 1))}${bc(border.br)}`;
  } else {
    bottomBorder = `${marginStr}${bc(border.bl)}${bc(border.h.repeat(innerWidth))}${bc(border.br)}`;
  }

  // Build content lines
  const bodyLines = rawLines.map((line) => {
    const visLen = visibleWidth(line);
    const availableWidth = innerWidth - pad * 2;
    const paddedLine = visLen < availableWidth
      ? line + " ".repeat(availableWidth - visLen)
      : line;
    return `${marginStr}${bc(border.v)}${" ".repeat(pad)}${paddedLine}${" ".repeat(pad)}${bc(border.v)}`;
  });

  // Build empty padding lines (if content exists)
  const emptyLine = `${marginStr}${bc(border.v)}${" ".repeat(innerWidth)}${bc(border.v)}`;

  const output = [topBorder];
  if (rawLines.length > 0) {
    output.push(...bodyLines);
  } else {
    output.push(emptyLine);
  }
  output.push(bottomBorder);

  return output.join("\n");
}

/**
 * Render a horizontal divider/separator line.
 *
 * @param {object} options
 * @param {string} [options.label] - Optional centered label
 * @param {number} [options.width] - Total width
 * @param {string} [options.char] - Divider character (default "─")
 * @param {Function} [options.chalk] - ANSI color function
 * @returns {string}
 */
export function renderDivider({ label, width = 80, char = "─", chalk } = {}) {
  if (!label) {
    const line = char.repeat(width);
    return chalk ? chalk.dim(line) : line;
  }

  const content = ` ${label.trim()} `;
  const remaining = Math.max(0, width - content.length);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  const line = `${char.repeat(left)}${content}${char.repeat(right)}`;
  return chalk ? chalk.dim(line) : line;
}

/**
 * Render a mid-border separator inside an existing box.
 *
 * @param {object} options
 * @param {string} [options.borderStyle]
 * @param {number} [options.innerWidth]
 * @param {number} [options.margin]
 * @param {Function} [options.chalk]
 * @returns {string}
 */
export function renderMidBorder({ borderStyle = "rounded", innerWidth = 40, margin = 0, chalk } = {}) {
  const border = BORDER_STYLES[borderStyle] || BORDER_STYLES.rounded;
  const marginStr = " ".repeat(margin);
  const bc = (char) => (chalk ? chalk.dim(char) : char);
  return `${marginStr}${bc(border.ml)}${bc(border.h.repeat(innerWidth))}${bc(border.mr)}`;
}
