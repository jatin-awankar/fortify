import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InputHistory } from "../src/renderers/prompt-editor.js";

describe("InputHistory", () => {
  let history;

  beforeEach(() => {
    history = new InputHistory({ maxSize: 10 });
  });

  describe("push", () => {
    it("adds entries", () => {
      history.push("hello");
      history.push("world");
      assert.equal(history.size, 2);
    });

    it("deduplicates consecutive entries", () => {
      history.push("hello");
      history.push("hello");
      assert.equal(history.size, 1);
    });

    it("does not deduplicate non-consecutive duplicates", () => {
      history.push("hello");
      history.push("world");
      history.push("hello");
      assert.equal(history.size, 3);
    });

    it("ignores empty and whitespace-only entries", () => {
      history.push("");
      history.push("   ");
      history.push(null);
      assert.equal(history.size, 0);
    });

    it("trims entries", () => {
      history.push("  hello  ");
      const entries = history.getEntries();
      assert.equal(entries[0], "hello");
    });

    it("enforces maxSize", () => {
      for (let i = 0; i < 15; i++) {
        history.push(`entry-${i}`);
      }
      assert.equal(history.size, 10);
      const entries = history.getEntries();
      assert.equal(entries[0], "entry-5");
      assert.equal(entries[9], "entry-14");
    });
  });

  describe("previous / next navigation", () => {
    it("navigates backward through entries", () => {
      history.push("first");
      history.push("second");
      history.push("third");

      const entry1 = history.previous("current draft");
      assert.equal(entry1, "third");

      const entry2 = history.previous();
      assert.equal(entry2, "second");

      const entry3 = history.previous();
      assert.equal(entry3, "first");
    });

    it("stays at oldest entry when navigating past beginning", () => {
      history.push("only-one");

      history.previous();
      const again = history.previous();
      assert.equal(again, "only-one");
    });

    it("navigates forward back to draft", () => {
      history.push("first");
      history.push("second");

      history.previous("my draft");
      history.previous();

      const forward1 = history.next();
      assert.equal(forward1, "second");

      const forward2 = history.next();
      assert.equal(forward2, "my draft");
    });

    it("returns null for previous/next on empty history", () => {
      assert.equal(history.previous(), null);
      assert.equal(history.next(), null);
    });
  });

  describe("resetCursor", () => {
    it("resets navigation state", () => {
      history.push("hello");
      history.previous("draft");
      history.resetCursor();

      // After reset, previous should start from the end again
      const result = history.previous("new draft");
      assert.equal(result, "hello");
    });
  });

  describe("getEntries", () => {
    it("returns a copy of entries", () => {
      history.push("a");
      history.push("b");

      const entries = history.getEntries();
      entries.push("c"); // Mutate the copy

      assert.equal(history.size, 2, "Original should not be affected");
    });
  });

  describe("load", () => {
    it("loads entries from an array", () => {
      history.load(["pre-loaded-1", "pre-loaded-2"]);
      assert.equal(history.size, 2);

      const entries = history.getEntries();
      assert.equal(entries[0], "pre-loaded-1");
    });

    it("respects maxSize when loading", () => {
      const big = Array.from({ length: 20 }, (_, i) => `item-${i}`);
      history.load(big);
      assert.equal(history.size, 10);
    });

    it("handles non-array gracefully", () => {
      history.push("existing");
      history.load(null);
      assert.equal(history.size, 1, "Should preserve existing when given non-array");
    });
  });

  describe("clear", () => {
    it("clears all entries and resets cursor", () => {
      history.push("a");
      history.push("b");
      history.clear();

      assert.equal(history.size, 0);
      assert.equal(history.previous(), null);
    });
  });
});
