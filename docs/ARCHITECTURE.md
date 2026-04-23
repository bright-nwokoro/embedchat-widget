# Architecture

Phase 1 + Phase 2 architecture. See [the Phase 1 design spec](superpowers/specs/2026-04-21-embedchat-phase-1-design.md) for rationale.

## Components

```
┌─────────────────────────────────────┐      ┌───────────────────────────────┐
│ Host page                           │      │ embedchat-cdn.brightnwokoro.dev│
│   <script src=".../embedchat.js"    │──────│ Worker serves /embedchat.js   │
│           data-site-id="..."        │ GET  │ cache: 1yr immutable          │
│           data-api-url="..." />     │      └───────────────────────────────┘
│                                     │
│   ┌── Shadow DOM ──┐                │      ┌───────────────────────────────┐
│   │ Bubble + Panel │ ──── POST ────▶│─────▶│ embedchat-api.brightnwokoro.dev│
│   │ (vanilla TS)   │ ◀── SSE stream │      │ Hono /chat                    │
│   └────────────────┘                │      │  ├─ CORS                      │
└─────────────────────────────────────┘      │  ├─ Rate-limit (KV)           │
                                             │  ├─ Prompt wrap               │
                                             │  ├─ RAG retrieval (step 7a) ──┼──▶ ┌─────────────┐
                                             │  └─ Provider dispatch ──┐     │    │ Supabase    │
                                             └───────────────────────┬─┴─────┘    │ (pgvector)  │
                                                                     │            └─────────────┘
                                                       ┌─────────────┴───────┐
                                                       │ OpenAI / Anthropic  │
                                                       └─────────────────────┘
```

## Request sequence — POST /chat

```
Widget                                    api-worker (Hono)                  LLM
  │                                             │                              │
  │─ POST {siteId, messages, model} ──────────▶ │                              │
  │                                             │ 1. getSite(siteId)           │
  │                                             │ 2. CORS check                │
  │                                             │ 3. Rate-limit gates (KV)     │
  │                                             │ 4. Validate shape            │
  │                                             │ 5. Trim history              │
  │                                             │ 6. Wrap user msgs in tags    │
  │                                             │ 7a. Best-effort RAG (≤2000ms)│
  │                                             │     → embed → retrieve       │
  │                                             │     → inject <context>       │
  │                                             │ 7. Start provider.stream ─▶ │
  │ ◀── SSE: data:{"t":"token","v":"..."} ──── ◀│ ◀── stream chunks ───────── │
  │ ◀── SSE: data:{"t":"token","v":"..."} ──── ◀│                              │
  │ ◀── SSE: data:{"t":"done","usage":...} ─── ◀│ 8. incrementTokens(KV)       │
```

## File map

| Path | Responsibility |
|---|---|
| `widget/src/index.ts`         | Entry: reads data-*, boots `mount` |
| `widget/src/config.ts`        | Parses + validates config |
| `widget/src/root.ts`          | Shadow DOM attach, send controller |
| `widget/src/transport.ts`     | SSE parser |
| `widget/src/store.ts`         | pub/sub state |
| `widget/src/ui/*.ts`          | Bubble, Panel, MessageList, Composer |
| `api-worker/src/index.ts`     | Hono app wire-up |
| `api-worker/src/routes/chat.ts` | The main pipeline |
| `api-worker/src/sites.ts`     | Site registry |
| `api-worker/src/prompt.ts`    | Injection defense |
| `api-worker/src/ratelimit.ts` | KV counters |
| `api-worker/src/llm/provider.ts` | Shared interface + model map |
| `api-worker/src/llm/openai.ts`| OpenAI streaming |
| `api-worker/src/llm/anthropic.ts` | Anthropic streaming |
| `cdn-worker/src/index.ts`     | Serves widget bundle with immutable cache |
| `demo/src/index.html`         | Landing page embedding widget |

## Abuse defense

- **Site-ID tiering** — `demo-public` is open to any origin but ignores client-supplied system prompts and uses short output caps. Named site-ids (future) have origin allowlists.
- **Rate limits** — three KV-counter gates: 20 req/IP/10min, 200 req/origin/day, 500k tokens/day globally. Any one trip → 429.
- **Prompt injection** — user messages wrapped in `<user_message>…</user_message>`; system prompt instructs model to treat tagged content as data, not instructions.
- **Input validation** — siteId regex, message length, message count, model enum, role enum.

## Data flow: no PII, no storage

Phase 1 stores nothing. Every request is processed in-memory, streamed out, and forgotten. Only KV counters persist, and they contain no message content — just integer counts against scoped keys.

## Phase 2 file additions

| Path | Responsibility |
|---|---|
| `supabase/schema.sql`                      | DDL: sites + chunks + match_chunks RPC |
| `ingestion/bin/ingest.ts`                  | CLI entry (`pnpm ingest`) |
| `ingestion/src/chunk/markdown.ts`          | Markdown-aware recursive splitter |
| `ingestion/src/chunk/typescript.ts`        | Top-level-decl splitter via TS compiler API |
| `ingestion/src/embed/openai.ts`            | Batched embedding calls |
| `ingestion/src/store/supabase.ts`          | Upsert site + replace chunks |
| `ingestion/src/orchestrator.ts`            | Wires crawl → chunk → embed → store |
| `api-worker/src/rag/embed-query.ts`        | Query embedding per chat |
| `api-worker/src/rag/retrieve.ts`           | Site state + top-k via RPC; fails open (returns empty on error for graceful fallback) |
| `api-worker/src/rag/context.ts`            | Formats `<context>` blocks with escaping |
| `api-worker/src/routes/chat.ts` (modified) | Inserts step 7a |

## Phase 3a: Dynamic ingestion pipeline

```
Operator (CLI)                api-worker                  Cloudflare Queue         ingest-worker              Supabase
     │                            │                             │                        │                        │
     │─ POST /admin/sites ───────▶│                             │                        │                        │
     │   + Bearer token           │ 1. Validate + HEAD preflight│                        │                        │
     │                            │ 2. INSERT sites (pending)   │                        │                        │
     │                            │ 3. queue.send()             │                        │                        │
     │ ◀── 202 Accepted ──────────│─────────────────────────────▶                         │                        │
     │                            │                             │                        │                        │
     │                            │                             │ 4. deliver batch ──────▶                        │
     │                            │                             │                        │ 5. PATCH sites='indexing'
     │                            │                             │                        │ 6. GET sitemap.xml ────▶
     │                            │                             │                        │ 7. For each URL:        │
     │                            │                             │                        │      fetch HTML         │
     │                            │                             │                        │      HTMLRewriter extract
     │                            │                             │                        │      plain-text chunk   │
     │                            │                             │                        │ 8. POST /v1/embeddings ▶
     │                            │                             │                        │ 9. DELETE chunks + INSERT
     │                            │                             │                        │ 10. PATCH sites='ready'
     │                            │                             │                        │                        │
     │─ pnpm register-site --status <siteId> ───▶ GET /admin/sites/:id                    │                        │
     │ ◀── { status: "ready" } ───────────────────────────────────────────────────────────│                        │
```

## Phase 3a file additions

| Path | Responsibility |
|---|---|
| `api-worker/src/sites-db.ts`                   | Supabase-backed `getSite()` with 10s TTL cache |
| `api-worker/src/queue.ts`                      | `enqueueIngest()` helper |
| `api-worker/src/routes/admin.ts`               | POST/GET/reingest/DELETE sites + bearer auth |
| `ingest-worker/src/index.ts`                   | Queue consumer; orchestrates crawl → chunk → embed → store |
| `ingest-worker/src/sitemap.ts`                 | Sitemap.xml fetch + parse |
| `ingest-worker/src/extract.ts`                 | HTMLRewriter-based text extraction |
| `ingest-worker/src/plaintext-chunker.ts`       | Paragraph-packing chunker with 50-token overlap |
| `ingest-worker/src/embed.ts`                   | Batched OpenAI embedding |
| `ingest-worker/src/supabase.ts`                | Service-role helpers for status + chunk replacement |
| `ingestion/bin/register-site.ts`               | CLI wrapper for admin API |
| `supabase/migrations/2026-04-22-phase-3a.sql`  | Phase 2 → Phase 3a migration |
