import { encodingForModel } from "js-tiktoken";

export const TARGET_TOKENS = 500;
export const OVERLAP_TOKENS = 50;
const MIN_TOKENS = 20;

const encoder = encodingForModel("text-embedding-3-small");

function countTokens(text: string): number {
  return encoder.encode(text).length;
}

function tailTokens(text: string, n: number): string {
  const tokens = encoder.encode(text);
  if (tokens.length <= n) return text;
  const tail = tokens.slice(tokens.length - n);
  return encoder.decode(tail);
}

export interface ChunkOptions {
  siteId: string;
  sourcePath: string;
  headingPath: string;
}

export interface PlainTextChunk {
  site_id: string;
  source_path: string;
  heading_path: string;
  chunk_index: number;
  content: string;
  token_count: number;
}

export function chunkPlainText(text: string, opts: ChunkOptions): PlainTextChunk[] {
  const normalized = text.trim();
  if (normalized.length === 0) return [];

  const totalTokens = countTokens(normalized);
  if (totalTokens <= TARGET_TOKENS) {
    // For single-chunk inputs, only reject trivially-short fragments (e.g. a
    // single word like "tiny"). The MIN_TOKENS guard below still applies when
    // packing multi-chunk outputs to drop fragmentary trailing chunks.
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount < 2) return [];
    return [
      {
        site_id: opts.siteId,
        source_path: opts.sourcePath,
        heading_path: opts.headingPath,
        chunk_index: 0,
        content: normalized,
        token_count: totalTokens,
      },
    ];
  }

  let paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 1) {
    paragraphs = paragraphs[0]!.split(/(?<=[.!?])\s+/);
  }

  const chunks: PlainTextChunk[] = [];
  let idx = 0;
  let buffer: string[] = [];
  let bufferTokens = 0;
  let lastChunkContent: string | null = null;

  function flush() {
    if (buffer.length === 0) return;
    const content = buffer.join("\n\n");
    const tokenCount = countTokens(content);
    if (tokenCount >= MIN_TOKENS) {
      chunks.push({
        site_id: opts.siteId,
        source_path: opts.sourcePath,
        heading_path: opts.headingPath,
        chunk_index: idx++,
        content,
        token_count: tokenCount,
      });
      lastChunkContent = content;
    }
    buffer = [];
    bufferTokens = 0;
  }

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);
    if (bufferTokens + paraTokens > TARGET_TOKENS && buffer.length > 0) {
      flush();
      if (lastChunkContent) {
        const overlap = tailTokens(lastChunkContent, OVERLAP_TOKENS);
        buffer.push(overlap);
        bufferTokens += countTokens(overlap);
      }
    }
    buffer.push(para);
    bufferTokens += paraTokens;
  }
  flush();

  return chunks;
}
