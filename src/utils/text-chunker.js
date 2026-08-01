export function chunkText(text, { chunkSize = 6_000, overlap = 300 } = {}) {
  if (typeof text !== "string" || !text.length) {
    return [];
  }

  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than zero.");
  }

  const safeOverlap = Math.max(0, Math.min(overlap, Math.floor(chunkSize * 0.5)));
  const chunks = [];

  let index = 0;
  while (index < text.length) {
    const end = Math.min(text.length, index + chunkSize);
    chunks.push(text.slice(index, end));

    if (end >= text.length) {
      break;
    }

    index = end - safeOverlap;
  }

  return chunks;
}
