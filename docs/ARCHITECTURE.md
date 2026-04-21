# Architecture

Phase 1 architecture. See [the Phase 1 design spec](superpowers/specs/2026-04-21-embedchat-phase-1-design.md) for rationale.

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
                                             │  └─ Provider dispatch ──┐     │
                                             └───────────────────────┬─┴─────┘
                                                                     │
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

## Phase 2: RAG retrieval step

```
Widget                api-worker (Hono)                    Supabase (pgvector)    OpenAI
  │                        │                                        │               │
  │─ POST /chat ─────────▶ │                                        │               │
  │                        │ Phase 1 steps 1-6 (CORS, rate-limit,   │               │
  │                        │   validate, trim, wrap)                │               │
  │                        │                                        │               │
  │                        │ 7a. If site.status=ready in sites:     │               │
  │                        │   ─── GET /rest/v1/sites ───────────▶ │               │
  │                        │ ◀─ site row ─────────────────────────  │               │
  │                        │   ─── POST /v1/embeddings (query) ─────────────────▶ │
  │                        │ ◀─ embedding ──────────────────────────────────────── │
  │                        │   ─── POST /rest/v1/rpc/match_chunks ─▶               │
  │                        │ ◀─ top-5 chunks ──────────────────────                │
  │                        │   build system prompt with <context>                   │
  │                        │                                        │               │
  │                        │ 7. Provider stream ─ POST /v1/chat/completions ─────▶ │
  │ ◀── SSE tokens ─────── │ ◀── stream chunks ───────────────────────────────── │
  │ ◀── SSE done ───────── │   incrementTokens(KV)                                  │
```

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
| `api-worker/src/rag/retrieve.ts`           | Site state + top-k via RPC; fails closed |
| `api-worker/src/rag/context.ts`            | Formats `<context>` blocks with escaping |
| `api-worker/src/routes/chat.ts` (modified) | Inserts step 7a |
