import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Chunk } from "../types";

export interface SiteMeta {
  site_id: string;
  name: string;
  knowledge_source: string;
}

export function createStoreClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function storeSiteChunks(
  sb: SupabaseClient,
  site: SiteMeta,
  chunks: Chunk[],
): Promise<void> {
  // 1. Upsert site row with status=indexing.
  {
    const { error } = await sb.from("sites").upsert({
      site_id: site.site_id,
      name: site.name,
      knowledge_source: site.knowledge_source,
      status: "indexing",
    });
    if (error) throw new Error(`Supabase sites upsert: ${error.message}`);
  }

  // 2. Delete existing chunks for this site.
  {
    const { error } = await sb.from("chunks").delete().eq("site_id", site.site_id);
    if (error) throw new Error(`Supabase chunks delete: ${error.message}`);
  }

  // 3. Insert new chunks in one batch.
  //    pgvector accepts the embedding as a JSON array literal via stringify.
  const rows = chunks.map((c) => ({
    site_id: c.site_id,
    source_path: c.source_path,
    heading_path: c.heading_path,
    chunk_index: c.chunk_index,
    content: c.content,
    token_count: c.token_count,
    embedding: JSON.stringify(c.embedding ?? []),
  }));
  {
    const { error } = await sb.from("chunks").insert(rows);
    if (error) throw new Error(`Supabase chunks insert: ${error.message}`);
  }

  // 4. Mark site ready with chunk_count + last_indexed_at.
  {
    const { error } = await sb
      .from("sites")
      .update({
        status: "ready",
        chunk_count: chunks.length,
        last_indexed_at: new Date().toISOString(),
      })
      .eq("site_id", site.site_id);
    if (error) throw new Error(`Supabase sites update: ${error.message}`);
  }
}

export async function markSiteFailed(
  sb: SupabaseClient,
  siteId: string,
): Promise<void> {
  await sb.from("sites").update({ status: "failed" }).eq("site_id", siteId);
}
