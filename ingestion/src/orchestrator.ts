import type { SupabaseClient } from "@supabase/supabase-js";
import type { Chunk, IngestConfig } from "./types";
import { readSources } from "./sources/local-repo";
import { chunkFile } from "./chunk";
import { embedAll } from "./embed/openai";
import { createStoreClient, storeSiteChunks, markSiteFailed } from "./store/supabase";

export interface IngestOptions {
  /** Inject a stubbed Supabase client for testing; otherwise one is created. */
  supabaseClient?: SupabaseClient;
  /** Optional limit to a single file path (for --file iteration). */
  filter?: (path: string) => boolean;
  /** Skip embed + store (dry run). */
  dryRun?: boolean;
}

export async function ingest(
  config: IngestConfig,
  options: IngestOptions = {},
): Promise<number> {
  const paths = options.filter
    ? config.sources.filter(options.filter)
    : config.sources;
  const sources = readSources(config.repoRoot, paths);

  const chunks: Chunk[] = [];
  for (const src of sources) {
    const fileChunks = chunkFile(src.content, {
      siteId: config.siteId,
      sourcePath: src.path,
    });
    chunks.push(...fileChunks);
  }

  if (options.dryRun) {
    console.log(
      `ingest: dry-run complete. ${chunks.length} chunks from ${sources.length} sources. Skipping embed + store.`,
    );
    return chunks.length;
  }

  if (chunks.length === 0) {
    throw new Error("ingest: no chunks produced — source allowlist may be wrong");
  }

  const vectors = await embedAll(
    chunks.map((c) => c.content),
    config.openaiApiKey,
  );
  for (let i = 0; i < chunks.length; i++) {
    chunks[i]!.embedding = vectors[i]!;
  }

  const sb =
    options.supabaseClient ??
    createStoreClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  try {
    await storeSiteChunks(
      sb,
      {
        site_id: config.siteId,
        name: config.siteName,
        knowledge_source: config.knowledgeSource,
      },
      chunks,
    );
  } catch (e) {
    await markSiteFailed(sb, config.siteId).catch(() => {});
    throw e;
  }

  return chunks.length;
}
