export interface Source {
  path: string;        // relative path, e.g. "README.md"
  content: string;     // file content
}

export interface Chunk {
  site_id: string;
  source_path: string;
  heading_path: string | null;
  chunk_index: number;
  content: string;
  token_count: number;
  // embedding added after embed phase; stored as number[] until serialization
  embedding?: number[];
}

export interface IngestConfig {
  siteId: string;
  siteName: string;
  knowledgeSource: string;
  sources: string[];              // repo-relative paths to ingest
  repoRoot: string;               // absolute path
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  openaiApiKey: string;
}
