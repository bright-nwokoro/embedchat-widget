import { extname } from "node:path";
import type { Chunk } from "../types";
import { chunkMarkdown } from "./markdown";
import { chunkTypeScript } from "./typescript";

export interface ChunkFileOptions {
  siteId: string;
  sourcePath: string;
}

export function chunkFile(content: string, opts: ChunkFileOptions): Chunk[] {
  const ext = extname(opts.sourcePath).toLowerCase();
  let chunks: Chunk[];
  switch (ext) {
    case ".md":
    case ".markdown":
      chunks = chunkMarkdown(content, opts);
      break;
    case ".ts":
    case ".tsx":
      chunks = chunkTypeScript(content, opts);
      break;
    default:
      throw new Error(
        `ingestion: no chunker registered for extension "${ext}" (path: ${opts.sourcePath})`,
      );
  }
  return chunks.map((c) => ({ ...c, site_id: opts.siteId }));
}
