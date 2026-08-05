export function buildChunkSummaryInstructions() {
  return [
    "You are a senior software engineer generating compact technical summaries.",
    "Summarize the provided file chunk in 3-5 concise bullet points.",
    "Focus on purpose, important logic, data flow, and notable risks.",
    "Do not repeat the raw code."
  ].join(" ");
}

export function buildChunkSummaryInput({
  relativePath,
  chunkIndex,
  totalChunks,
  chunkContent
} = {}) {
  return [
    `File: ${relativePath}`,
    `Chunk: ${chunkIndex + 1}/${totalChunks}`,
    "Content:",
    chunkContent
  ].join("\n");
}

export function buildFinalSummaryInstructions({ format = "bullet" } = {}) {
  const normalizedFormat = typeof format === "string" ? format.trim().toLowerCase() : "bullet";
  const formatRule =
    normalizedFormat === "paragraph"
      ? "Respond as short paragraphs with clear sections."
      : "Respond as concise bullet points grouped by topic.";

  return [
    "You are a principal engineer writing a project summary for developers.",
    formatRule,
    "Explain architecture, key modules, major behaviors, and likely next steps.",
    "Call out risks or unknowns when present.",
    "Keep the tone professional and direct."
  ].join(" ");
}

export function buildFinalSummaryInput({
  sourcePath,
  totalFiles,
  totalChunks,
  chunkSummaries
} = {}) {
  const serializedChunkSummaries = (chunkSummaries || [])
    .map(
      (entry, index) =>
        `${index + 1}. [${entry?.relativePath} chunk ${(entry?.chunkIndex || 0) + 1}/${entry?.totalChunks}]\n${entry?.summary}`
    )
    .join("\n\n");

  return [
    `Target path: ${sourcePath}`,
    `Files processed: ${totalFiles}`,
    `Chunks summarized: ${totalChunks}`,
    "Chunk summaries:",
    serializedChunkSummaries
  ].join("\n");
}
