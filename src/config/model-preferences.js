const DEFAULT_MODEL = "gpt-5.1";

function appendUniqueModel(chain, model) {
  if (typeof model !== "string") {
    return;
  }

  const trimmedModel = model.trim();
  if (!trimmedModel || chain.includes(trimmedModel)) {
    return;
  }

  chain.push(trimmedModel);
}

export function resolveModelChain(config, explicitModel, defaultModel = DEFAULT_MODEL) {
  const preferences = config?.modelPreferences ?? {};
  const chain = [];

  appendUniqueModel(chain, explicitModel || preferences.defaultModel || defaultModel);

  if (Array.isArray(preferences.fallbackModels)) {
    for (const model of preferences.fallbackModels) {
      appendUniqueModel(chain, model);
    }
  }

  if (chain.length === 0) {
    chain.push(defaultModel);
  }

  return chain;
}
