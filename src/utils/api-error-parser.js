export function parseApiErrorResponse(status, errorText, providerName = "AI Provider") {
  let parsedMessage = "";
  try {
    const json = JSON.parse(errorText);
    if (json?.error?.message) {
      // Pick first meaningful sentence/line
      parsedMessage = json.error.message.split("\n")[0].trim();
    } else if (typeof json?.error === "string") {
      parsedMessage = json.error.trim();
    }
  } catch {
    parsedMessage = (errorText || "").trim();
  }

  if (status === 429) {
    return `${providerName} API quota/rate limit exceeded (429): ${parsedMessage || "Quota or rate limit reached. Please wait a moment or check your API key plan."}`;
  }

  if (status === 401 || status === 403) {
    return `${providerName} API authentication failed (${status}): Invalid API key or permission denied. Run \`fortify auth\` to update your key.`;
  }

  return `${providerName} API error (${status}): ${parsedMessage || errorText.slice(0, 150)}`;
}
