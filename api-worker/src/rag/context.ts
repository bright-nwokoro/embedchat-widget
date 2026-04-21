import type { RetrievedChunk } from "./types";

const PREAMBLE = `You have access to context retrieved from the EmbedChat project documentation and source code. Use it to answer the user's question. Cite the source path where relevant (e.g. "per README.md"). If the context does not contain the answer, say you don't know rather than guessing.`;

function escapeAttr(v: string): string {
  return v.replace(/"/g, "&quot;");
}

function escapeContent(v: string): string {
  return v.split("</context>").join("< /context>");
}

function formatChunk(chunk: RetrievedChunk): string {
  const source = escapeAttr(chunk.source_path);
  const heading = chunk.heading_path ? ` heading="${escapeAttr(chunk.heading_path)}"` : "";
  const body = escapeContent(chunk.content);
  return `<context source="${source}"${heading}>\n${body}\n</context>`;
}

export function buildContextSystemPrompt(
  originalSystemPrompt: string,
  chunks: RetrievedChunk[],
): string {
  if (chunks.length === 0) return originalSystemPrompt;
  const blocks = chunks.map(formatChunk).join("\n\n");
  return `${PREAMBLE}\n\n${blocks}\n\n${originalSystemPrompt}`;
}
