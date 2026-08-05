import {
  getConfigPath,
  getConfigValue,
  loadConfig,
  saveConfig,
  setConfigValue,
  validateConfig,
} from "../config/index.js";
import { createTerminalUI } from "../renderers/index.js";
import { getRuntimeOptions } from "../utils/runtime-options.js";



function parseConfigValue(rawValue) {
  const trimmed = String(rawValue ?? "").trim();

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed === "null") {
    return null;
  }

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    return JSON.parse(trimmed);
  }

  if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }

  return rawValue;
}

function redactConfigValue(keyPath, value) {
  if (!keyPath.startsWith("apiKeys.")) {
    return value;
  }

  if (typeof value !== "string" || !value) {
    return "";
  }

  if (value.length <= 11) {
    return "****";
  }

  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}

function redactConfig(config) {
  const redactedApiKeys = { ...config.apiKeys };
  for (const provider of Object.keys(redactedApiKeys)) {
    redactedApiKeys[provider] = redactConfigValue(`apiKeys.${provider}`, redactedApiKeys[provider]);
  }
  return {
    ...config,
    apiKeys: redactedApiKeys,
  };
}

export class ConfigService {
  constructor({
    configLoader = loadConfig,
    configSaver = saveConfig,
    configPathResolver = getConfigPath,
    terminalUI = createTerminalUI(),
  } = {}) {
    this.configLoader = configLoader;
    this.configSaver = configSaver;
    this.configPathResolver = configPathResolver;
    this.terminalUI = terminalUI;
  }

  async listConfig() {
    const config = await this.configLoader();
    const redacted = redactConfig(config);

    if (!getRuntimeOptions().json) {
      this.terminalUI.divider("Fortify Config");
      this.terminalUI.info(`Location: ${this.configPathResolver()}`);
      this.terminalUI.stdout.write(`${JSON.stringify(redacted, null, 2)}\n`);
    }

    return { ok: true, config: redacted, path: this.configPathResolver() };
  }

  async getConfig({ key }) {
    const config = await this.configLoader();
    const value = getConfigValue(redactConfig(config), key);

    if (typeof value === "undefined") {
      this.terminalUI.error(`Config key '${key}' was not found.`);
      return { ok: false, reason: "not_found", key };
    }

    if (!getRuntimeOptions().json) {
      this.terminalUI.stdout.write(
        typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`,
      );
    }

    return { ok: true, key, value };
  }

  async setConfig({ key, value }) {
    let parsedValue;
    try {
      parsedValue = parseConfigValue(value);
      if (parsedValue === null) {
        throw new Error("Cannot set config value to null.");
      }
    } catch (error) {
      this.terminalUI.error(error.message === "Cannot set config value to null." ? error.message : "Config value must be valid JSON when using object or array syntax.");
      return { ok: false, reason: "invalid_value", key, error };
    }

    const currentConfig = await this.configLoader();
    const nextConfig = setConfigValue(currentConfig, key, parsedValue);
    const validation = validateConfig(nextConfig);

    if (!validation.ok) {
      this.terminalUI.error(`Invalid config: ${validation.issues.join(" ")}`);
      return { ok: false, reason: "invalid_config", key, issues: validation.issues };
    }

    const savedConfig = await this.configSaver(nextConfig);
    this.terminalUI.success(`Saved ${key}.`);

    return {
      ok: true,
      key,
      value: redactConfigValue(key, getConfigValue(savedConfig, key)),
    };
  }

  async validateConfig() {
    const config = await this.configLoader();
    const validation = validateConfig(config);

    if (!validation.ok) {
      this.terminalUI.error(`Config is invalid: ${validation.issues.join(" ")}`);
      return { ok: false, reason: "invalid_config", issues: validation.issues };
    }

    this.terminalUI.success("Config is valid.");
    return { ok: true, path: this.configPathResolver() };
  }
}
