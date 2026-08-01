export function estimateTokenCountFromText(text) {
  if (typeof text !== "string" || !text.length) {
    return 0;
  }

  const byteLength = Buffer.byteLength(text, "utf8");
  return Math.max(1, Math.ceil(byteLength / 3.5));
}

export function trimItemsToTokenBudget(
  items,
  { maxTokens, textSelector = (item) => String(item ?? "") } = {}
) {
  if (!Array.isArray(items)) {
    return [];
  }

  if (typeof maxTokens !== "number" || maxTokens <= 0) {
    return [];
  }

  let consumedTokens = 0;
  const acceptedItems = [];

  for (const item of items) {
    const estimatedTokens = estimateTokenCountFromText(textSelector(item));

    if (consumedTokens + estimatedTokens > maxTokens) {
      break;
    }

    acceptedItems.push(item);
    consumedTokens += estimatedTokens;
  }

  return acceptedItems;
}
