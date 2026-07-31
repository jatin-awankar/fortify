import assert from "node:assert/strict";
import test from "node:test";
import { PluginService } from "../src/services/plugin-service.js";

test("PluginService expands prompt shortcuts correctly", async () => {
  const service = new PluginService();
  const input = "Please run @security-check on this snippet.";
  const expanded = await service.expandPromptShortcuts(input);

  assert.ok(expanded.includes("OWASP vulnerabilities"));
  assert.ok(expanded.includes("injection risks"));
});

test("PluginService listPlugins returns empty array when no local rules or plugins exist", async () => {
  const mockFs = {
    stat: async () => {
      throw new Error("ENOENT");
    },
    readdir: async () => {
      throw new Error("ENOENT");
    },
    readFile: async () => ""
  };

  const service = new PluginService({ fsPromises: mockFs });
  const plugins = await service.listPlugins();
  assert.equal(plugins.length, 0);
});

test("PluginService loads custom rules.md when present", async () => {
  const mockFs = {
    stat: async () => ({ isFile: () => true, size: 50 }),
    readFile: async () => "- Maintain clean ESM standards.",
    readdir: async () => []
  };

  const service = new PluginService({ fsPromises: mockFs });
  const rules = await service.getCustomRules();
  assert.equal(rules, "- Maintain clean ESM standards.");

  const plugins = await service.listPlugins();
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0].name, "rules.md");
});
