import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getConfigValue,
  loadConfig,
  loadRuntimeConfig,
  saveConfig,
  setConfigValue,
  validateConfig,
} from "../src/config/index.js";

async function withFortifyHome(fn) {
  const previous = process.env.FORTIFY_HOME;
  const directory = path.join(tmpdir(), `fortify-test-${process.pid}-${Date.now()}-${Math.random()}`);
  process.env.FORTIFY_HOME = directory;

  try {
    return await fn(directory);
  } finally {
    if (typeof previous === "undefined") {
      delete process.env.FORTIFY_HOME;
    } else {
      process.env.FORTIFY_HOME = previous;
    }
  }
}

test("loadConfig returns normalized defaults when no config exists", async () => {
  await withFortifyHome(async () => {
    const config = await loadConfig();
    assert.equal(config.apiKeys.openai, "");
    assert.equal(typeof config.modelPreferences.defaultModel, "string");
    assert.deepEqual(validateConfig(config), { ok: true, issues: [] });
  });
});

test("saveConfig merges partial config with defaults", async () => {
  await withFortifyHome(async () => {
    const saved = await saveConfig({ apiKeys: { openai: "sk-local" } });
    assert.equal(saved.apiKeys.openai, "sk-local");
    assert.equal(saved.theme.useColor, true);
  });
});

test("loadConfig migrates legacy .aidevchef config", async () => {
  await withFortifyHome(async (home) => {
    const legacyDirectory = path.join(home, ".aidevchef");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(
      path.join(legacyDirectory, "config.json"),
      JSON.stringify({ apiKeys: { openai: "sk-legacy" } }),
      "utf8",
    );

    const config = await loadConfig();
    assert.equal(config.apiKeys.openai, "sk-legacy");
    assert.match(await readFile(path.join(home, ".fortify", "config.json"), "utf8"), /sk-legacy/);
  });
});

test("OPENAI_API_KEY overrides local config only at runtime", async () => {
  await withFortifyHome(async () => {
    await saveConfig({ apiKeys: { openai: "sk-local" } });
    const runtime = await loadRuntimeConfig({ env: { OPENAI_API_KEY: "sk-env" } });
    const stored = await loadConfig();

    assert.equal(runtime.apiKeys.openai, "sk-env");
    assert.equal(stored.apiKeys.openai, "sk-local");
  });
});

test("getConfigValue and setConfigValue handle dotted paths", () => {
  const config = { modelPreferences: { defaultModel: "a" } };
  const next = setConfigValue(config, "modelPreferences.defaultModel", "b");

  assert.equal(getConfigValue(next, "modelPreferences.defaultModel"), "b");
  assert.equal(getConfigValue(config, "modelPreferences.defaultModel"), "a");
});
