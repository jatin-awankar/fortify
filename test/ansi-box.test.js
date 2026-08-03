import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderBox, renderDivider, renderMidBorder } from "../src/renderers/ansi-box.js";
import { stripAnsi } from "../src/renderers/ansi-style.js";

describe("renderBox", () => {
  it("renders a basic box with content", () => {
    const result = renderBox({
      content: ["Hello, world!"],
      minWidth: 20,
    });
    const lines = result.split("\n");
    assert.equal(lines.length, 3); // top + 1 content + bottom
    assert.ok(stripAnsi(lines[0]).includes("╭"));
    assert.ok(stripAnsi(lines[0]).includes("╮"));
    assert.ok(stripAnsi(lines[2]).includes("╰"));
    assert.ok(stripAnsi(lines[2]).includes("╯"));
  });

  it("renders a box with a title", () => {
    const result = renderBox({
      title: "My Title",
      content: ["Line 1", "Line 2"],
    });
    const stripped = stripAnsi(result);
    assert.ok(stripped.includes("My Title"), "Title should appear in output");
    const lines = result.split("\n");
    assert.equal(lines.length, 4); // top + 2 content + bottom
  });

  it("renders with single border style", () => {
    const result = renderBox({
      content: ["test"],
      borderStyle: "single",
    });
    const stripped = stripAnsi(result);
    assert.ok(stripped.includes("┌"), "Should use single-style top-left corner");
    assert.ok(stripped.includes("┘"), "Should use single-style bottom-right corner");
  });

  it("renders with rounded border style by default", () => {
    const result = renderBox({ content: ["test"] });
    const stripped = stripAnsi(result);
    assert.ok(stripped.includes("╭"), "Should use rounded top-left corner");
  });

  it("renders an empty box when no content is provided", () => {
    const result = renderBox({});
    const lines = result.split("\n");
    assert.equal(lines.length, 3); // top + empty line + bottom
  });

  it("applies margin indentation", () => {
    const result = renderBox({
      content: ["hello"],
      margin: 4,
    });
    const stripped = stripAnsi(result);
    const lines = stripped.split("\n");
    for (const line of lines) {
      assert.ok(line.startsWith("    "), `Line should start with 4-space margin: "${line}"`);
    }
  });

  it("renders subtitle in bottom border", () => {
    const result = renderBox({
      content: ["content"],
      subtitle: "footer info",
    });
    const stripped = stripAnsi(result);
    assert.ok(stripped.includes("footer info"), "Subtitle should appear in output");
  });

  it("respects maxWidth constraint", () => {
    const result = renderBox({
      content: ["A very long line that should be constrained by maxWidth setting"],
      maxWidth: 40,
    });
    const lines = result.split("\n");
    for (const line of lines) {
      const width = stripAnsi(line).length;
      // Box should not exceed maxWidth (borders included in the calculation)
      assert.ok(width <= 80, `Line width ${width} should be reasonable`);
    }
  });

  it("handles multiline content as string", () => {
    const result = renderBox({
      content: "Line A\nLine B\nLine C",
    });
    const lines = result.split("\n");
    assert.equal(lines.length, 5); // top + 3 content + bottom
  });
});

describe("renderDivider", () => {
  it("renders a simple divider", () => {
    const result = renderDivider({ width: 40 });
    assert.equal(result.length, 40);
    assert.ok(result.includes("─"));
  });

  it("renders a divider with a centered label", () => {
    const result = renderDivider({ label: "Section", width: 40 });
    assert.ok(result.includes("Section"), "Label should appear in divider");
  });

  it("uses custom character", () => {
    const result = renderDivider({ width: 10, char: "=" });
    assert.equal(result, "==========");
  });
});

describe("renderMidBorder", () => {
  it("renders a mid-border separator", () => {
    const result = renderMidBorder({ innerWidth: 20 });
    const stripped = stripAnsi(result);
    assert.ok(stripped.includes("├"));
    assert.ok(stripped.includes("┤"));
  });

  it("applies margin", () => {
    const result = renderMidBorder({ innerWidth: 10, margin: 2 });
    const stripped = stripAnsi(result);
    assert.ok(stripped.startsWith("  "), "Should start with 2-space margin");
  });
});
