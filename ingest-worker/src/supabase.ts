import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { PlainTextChunk } from "./plaintext-chunker";

export function createServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function markSiteStatus(
  sb: SupabaseClient,
  siteId: string,
  patch: {
    status?: "pending" | "indexing" | "ready" | "failed";
    chunk_count?: number;
    last_indexed_at?: string;
    error_message?: string | null;
  },
): Promise<void> {
  const { error } = await sb.from("sites").update(patch).eq("site_id", siteId);
  if (error) throw new Error(`sites update: ${error.message}`);
}

export async function replaceChunks(
  sb: SupabaseClient,
  siteId: string,
  chunks: (PlainTextChunk & { embedding: number[] })[],
): Promise<void> {
  {
    const { error } = await sb.from("chunks").delete().eq("site_id", siteId);
    if (error) throw new Error(`chunks delete: ${error.message}`);
  }
  if (chunks.length === 0) return;
  const rows = chunks.map((c) => ({
    site_id: c.site_id,
    source_path: c.source_path,
    heading_path: c.heading_path,
    chunk_index: c.chunk_index,
    content: c.content,
    token_count: c.token_count,
    embedding: JSON.stringify(c.embedding),
  }));
  const { error } = await sb.from("chunks").insert(rows);
  if (error) throw new Error(`chunks insert: ${error.message}`);
}
