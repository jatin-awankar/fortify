function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getJitteredDelay(baseDelayMs, maxDelayMs, attempt) {
  const exponentialDelay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  const maxJitter = Math.floor(exponentialDelay * 0.25);
  const jitter = maxJitter > 0 ? Math.floor(Math.random() * maxJitter) : 1;
  return exponentialDelay + jitter;
}

export async function withRetry(
  operation,
  {
    maxRetries = 2,
    baseDelayMs = 300,
    maxDelayMs = 4_000,
    shouldRetry = () => true,
    onRetry = () => {}
  } = {}
) {
  let attempt = 0;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }

      const delayMs = getJitteredDelay(baseDelayMs, maxDelayMs, attempt);
      onRetry({ attempt, delayMs, error });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}
