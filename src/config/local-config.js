import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const CONFIG_DIRECTORY_NAME = ".fortify";
const LEGACY_CONFIG_DIRECTORY_NAME = ".aidevchef";
const CONFIG_FILE_NAME = "config.json";
const API_KEY_ENV_NAME = "OPENAI_API_KEY";

const DEFAULT_CONFIG = {
  apiKeys: {
    openai: "",
  },
  modelPreferences: {
    defaultModel: "gpt-5.4",
    fallbackModels: ["gpt-5.3", "gpt-5.4-mini"],
  },
  theme: {
    name: "default",
    useColor: true,
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeObjects(baseObject, overrideObject) {
  const output = { ...baseObject };

  if (!isPlainObject(overrideObject)) {
    return output;
  }

  for (const [key, value] of Object.entries(overrideObject)) {
    if (isPlainObject(value) && isPlainObject(baseObject[key])) {
      output[key] = mergeObjects(baseObject[key], value);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function normalizeConfig(configObject) {
  return mergeObjects(DEFAULT_CONFIG, configObject);
}

function getHomeDirectory() {
  return process.env.FORTIFY_HOME || homedir();
}

export function getConfigDirectory() {
  return path.join(getHomeDirectory(), CONFIG_DIRECTORY_NAME);
}

export function getConfigPath() {
  return path.join(getConfigDirectory(), CONFIG_FILE_NAME);
}

function getLegacyConfigPath() {
  return path.join(getHomeDirectory(), LEGACY_CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME);
}

async function migrateLegacyConfigIfNeeded() {
  const configPath = getConfigPath();

  try {
    await access(configPath);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const legacyConfigPath = getLegacyConfigPath();

  try {
    const legacyConfigContent = await readFile(legacyConfigPath, "utf8");
    await mkdir(getConfigDirectory(), { recursive: true });
    await writeFile(configPath, legacyConfigContent, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

export function getDefaultConfig() {
  return structuredClone(DEFAULT_CONFIG);
}

export async function loadConfig() {
  await migrateLegacyConfigIfNeeded();
  const configPath = getConfigPath();

  try {
    const configFileContent = await readFile(configPath, "utf8");
    const parsedConfig = JSON.parse(configFileContent);
    return normalizeConfig(parsedConfig);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return getDefaultConfig();
    }

    throw error;
  }
}

export async function loadRuntimeConfig({ env = process.env } = {}) {
  const config = await loadConfig();
  const envApiKey = typeof env[API_KEY_ENV_NAME] === "string" ? env[API_KEY_ENV_NAME].trim() : "";

  if (!envApiKey) {
    return config;
  }

  return mergeObjects(config, {
    apiKeys: {
      openai: envApiKey,
    },
  });
}

export async function saveConfig(config) {
  const configDirectory = getConfigDirectory();
  const configPath = getConfigPath();
  const normalizedConfig = normalizeConfig(config);

  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    configPath,
    `${JSON.stringify(normalizedConfig, null, 2)}\n`,
    "utf8",
  );

  return normalizedConfig;
}

export async function updateConfig(configPatch) {
  const currentConfig = await loadConfig();
  const nextConfig = mergeObjects(currentConfig, configPatch);
  return saveConfig(nextConfig);
}

export function getConfigValue(config, keyPath) {
  const parts = String(keyPath ?? "").split(".").filter(Boolean);
  let current = config;

  for (const part of parts) {
    if (!isPlainObject(current) || !(part in current)) {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

export function setConfigValue(config, keyPath, value) {
  const parts = String(keyPath ?? "").split(".").filter(Boolean);
  if (!parts.length) {
    throw new Error("Config key is required.");
  }

  const nextConfig = structuredClone(config);
  let current = nextConfig;

  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(current[part])) {
      current[part] = {};
    }

    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
  return nextConfig;
}

export class InvalidConfigError extends Error {
  constructor(message, { issues = [] } = {}) {
    super(message);
    this.name = "InvalidConfigError";
    this.code = "INVALID_CONFIG";
    this.issues = issues;
  }
}

export function validateConfig(config) {
  const issues = [];

  if (!isPlainObject(config)) {
    issues.push("Config must be a JSON object.");
  }

  if (!isPlainObject(config?.apiKeys)) {
    issues.push("apiKeys must be an object.");
  }

  if (typeof config?.apiKeys?.openai !== "string") {
    issues.push("apiKeys.openai must be a string.");
  }

  if (!isPlainObject(config?.modelPreferences)) {
    issues.push("modelPreferences must be an object.");
  }

  if (typeof config?.modelPreferences?.defaultModel !== "string") {
    issues.push("modelPreferences.defaultModel must be a string.");
  }

  if (!Array.isArray(config?.modelPreferences?.fallbackModels)) {
    issues.push("modelPreferences.fallbackModels must be an array.");
  } else if (!config.modelPreferences.fallbackModels.every((model) => typeof model === "string")) {
    issues.push("modelPreferences.fallbackModels must contain only strings.");
  }

  if (!isPlainObject(config?.theme)) {
    issues.push("theme must be an object.");
  }

  if (typeof config?.theme?.name !== "string") {
    issues.push("theme.name must be a string.");
  }

  if (typeof config?.theme?.useColor !== "boolean") {
    issues.push("theme.useColor must be a boolean.");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
