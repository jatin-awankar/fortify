const DEFAULT_RUNTIME_OPTIONS = {
  json: false,
  verbose: false,
  quiet: false,
};

let runtimeOptions = { ...DEFAULT_RUNTIME_OPTIONS };

export function setRuntimeOptions(options = {}) {
  runtimeOptions = {
    ...runtimeOptions,
    json: Boolean(options.json),
    verbose: Boolean(options.verbose),
    quiet: Boolean(options.quiet),
  };

  return getRuntimeOptions();
}

export function getRuntimeOptions() {
  return { ...runtimeOptions };
}

export function resetRuntimeOptions() {
  runtimeOptions = { ...DEFAULT_RUNTIME_OPTIONS };
}
