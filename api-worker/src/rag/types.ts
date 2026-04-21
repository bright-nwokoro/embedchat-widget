export interface RetrievedChunk {
  id: string;
  source_path: string;
  heading_path: string | null;
  content: string;
  similarity: number;
}

export interface SiteRagState {
  site_id: string;
  status: "pending" | "indexing" | "ready" | "failed";
  chunk_count: number;
  last_indexed_at: string | null;
}
