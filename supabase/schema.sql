-- EmbedChat Phase 3a schema. Run in Supabase SQL Editor on a fresh project.
-- Existing Phase 2 projects should run migrations/2026-04-22-phase-3a.sql instead.

create extension if not exists vector;

-- Per-site config + RAG state.
create table if not exists sites (
  site_id text primary key,
  name text,
  knowledge_source text,
  last_indexed_at timestamptz,
  chunk_count integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'indexing', 'ready', 'failed')),
  allowed_origins text[] not null default '{}',
  system_prompt text not null default '',
  allow_system_prompt_override boolean not null default false,
  allowed_models text[] not null default '{"gpt-4o-mini","claude-haiku"}',
  default_model text not null default 'gpt-4o-mini',
  max_message_chars integer not null default 2000,
  max_history_turns integer not null default 10,
  max_output_tokens integer not null default 400,
  error_message text
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

-- Similarity search RPC.
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

-- RLS on. api-worker + ingest-worker + CLI all use service_role which bypasses RLS.
-- Anon/authenticated roles have no policies → no access.
alter table sites enable row level security;
alter table chunks enable row level security;
