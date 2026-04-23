import type { RetrievedChunk, SiteRagState } from "./types";

async function postgrest(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = {
    ...(init.headers as Record<string, string> | undefined),
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  return fetch(`${supabaseUrl}${path}`, { ...init, headers });
}

export async function getSiteRagState(
  supabaseUrl: string,
  serviceKey: string,
  siteId: string,
): Promise<SiteRagState | null> {
  try {
    const res = await postgrest(
      supabaseUrl,
      serviceKey,
      `/rest/v1/sites?select=site_id,status,chunk_count,last_indexed_at&site_id=eq.${encodeURIComponent(siteId)}&limit=1`,
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as SiteRagState[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function retrieveChunks(
  supabaseUrl: string,
  serviceKey: string,
  siteId: string,
  queryEmbedding: number[],
  k: number,
): Promise<RetrievedChunk[]> {
  try {
    const res = await postgrest(supabaseUrl, serviceKey, `/rest/v1/rpc/match_chunks`, {
      method: "POST",
      body: JSON.stringify({
        query_embedding: queryEmbedding,
        match_site_id: siteId,
        match_count: k,
      }),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as RetrievedChunk[];
    return rows;
  } catch {
    return [];
  }
}
