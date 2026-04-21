-- EmbedChat Phase 2 schema. Run in Supabase SQL Editor on a fresh project.

create extension if not exists vector;

-- Per-site RAG state (generalized for Phase 3).
create table if not exists sites (
  site_id text primary key,
  name text,
  knowledge_source text,
  last_indexed_at timestamptz,
  chunk_count integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'indexing', 'ready', 'failed'))
);

-- Chunks with embeddings.
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references sites(site_id) on delete cascade,
  source_path text not null,
  heading_path text,
  chunk_index integer not null,
  content text not null,
  token_count integer not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists chunks_site_idx on chunks (site_id);
create index if not exists chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops);

-- Similarity search as an RPC (returns fewer round-trips than PostgREST for pgvector).
create or replace function match_chunks (
  query_embedding vector(1536),
  match_site_id text,
  match_count integer default 5
)
returns table (
  id uuid,
  source_path text,
  heading_path text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.source_path,
    c.heading_path,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  where c.site_id = match_site_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
