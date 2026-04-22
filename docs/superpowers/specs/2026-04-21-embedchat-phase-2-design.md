# EmbedChat — Phase 2 Design Spec (RAG Grounding)

**Date:** 2026-04-21
**Author:** Bright Nwokoro (with Claude)
**Status:** Approved, ready for implementation plan
**Depends on:** Phase 1 (shipped)

---

## 1. Overview

Phase 2 adds Retrieval-Augmented Generation to EmbedChat. The `demo-public` site-id becomes grounded on the EmbedChat repository itself — recruiters visiting the demo can ask questions like "how does rate limiting work?" or "what's in the chat route?" and get answers that cite specific files and sections.

The Phase 1 fallback behavior (ungrounded chat via OpenAI/Anthropic) is preserved: if Supabase is unreachable or retrieval fails, chat still works, just without RAG. RAG is best-effort.

Phase 2 is also the foundation for Phase 3: the data model, schema, and code paths are generalized so Phase 3 can honor `data-knowledge-url` for arbitrary customer sites without schema changes.

### 1.1 Phase 2 is "done" when:

1. `pnpm --filter=ingestion ingest` populates a fresh Supabase project with ≥ 40 chunks from the EmbedChat repo.
2. A query through the widget ("how does rate limiting work?") produces a reply that cites specific file/section paths from the corpus.
3. With Supabase misconfigured, chat still works — no 500s, no user-visible errors, just ungrounded responses.
4. All workspaces green: `pnpm test` passes (Phase 1's 49 tests plus ≥10 new Phase 2 tests).
5. Widget bundle size unchanged (RAG is backend-only; no widget code changes).

## 2. Scope

### 2.1 In scope (Phase 2)

- New `ingestion/` workspace package — CLI that crawls a hardcoded source list, chunks, embeds, and upserts to Supabase.
- New Supabase project with `pgvector`, `sites`, and `chunks` tables.
- New `api-worker/src/rag/` module — query embedding, vector search, context injection.
- Modified `api-worker/src/routes/chat.ts` — inserts a retrieval step between prompt wrapping and provider dispatch.
- RAG as a best-effort layer: failures fall back to ungrounded chat.
- Markdown-aware chunking for `.md` files; top-level-declaration chunking for `.ts` files.
- OpenAI `text-embedding-3-small` for both ingestion and query embedding.
- Supabase env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) added to api-worker.
- DDL in `supabase/schema.sql`, documented setup in `docs/DEPLOY.md`.
- TDD for all new non-trivial modules.

### 2.2 Out of scope (Phase 2)

Explicitly deferred — matches the "Hybrid" decision from brainstorming Q1:

- **`data-knowledge-url` honoring.** Widget still logs the Phase 1 notice. Phase 3.
- **Ingestion Worker (runnable HTTP endpoint).** CLI only. Phase 3 will add an `ingest-worker` that reuses the `ingestion/` library.
- **Multi-turn query expansion / HyDE / reranking.** Top-5 cosine against the latest user message only.
- **Ingestion UI / admin dashboard.** Manual `pnpm ingest` only.
- **Row-Level Security.** Single site; Phase 3 adds RLS when multiple tenants share the DB.
- **Delta / incremental ingestion.** Full refresh on every CLI run.
- **Per-site retrieval quotas** (separate from Phase 1's rate limits).
- **Query logging / retrieval analytics.** Phase 3.

## 3. Architecture

### 3.1 Deployment topology (Phase 1 + one external service)

```
embedchat-demo.brightnwokoro.dev  →  Cloudflare Pages
embedchat-cdn.brightnwokoro.dev   →  Workers (cdn-worker)
embedchat-api.brightnwokoro.dev   →  Workers (api-worker)   [adds retrieval step]
                                      │
                                      ▼ (REST over fetch)
                              Supabase (Postgres + pgvector)  [NEW]
                                      ▲
                                      │ upsert via service-role key
                                      │
                              ingestion/ CLI  [NEW — local-only, not deployed]
```

**New:** Supabase project, `ingestion/` workspace package.
**Modified:** `api-worker` only.
**Unchanged:** widget, cdn-worker, demo, all Phase 1 site-ID logic, rate limits, CORS, bundle, tests.

### 3.2 Database schema

Authoritative DDL in `supabase/schema.sql`:

```sql
create extension if not exists vector;

-- Per-site RAG state (generalized for Phase 3)
create table sites (
  site_id text primary key,
  name text,
  knowledge_source text,                   -- e.g. "EmbedChat repo" or a URL
  last_indexed_at timestamptz,
  chunk_count integer not null default 0,
  status text not null default 'pending'
);

-- Chunks with embeddings
create table chunks (
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

create index chunks_site_idx on chunks (site_id);
create index chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops);
```

**Status enum values:** `pending` | `indexing` | `ready` | `failed`. The api-worker's retrieval gate checks `status = 'ready'` — any other value means skip RAG and fall back to ungrounded.

**Dimensions pinned at 1536** for OpenAI `text-embedding-3-small`. If the embedder ever changes, the column type changes too; breaking migration, not a silent reindex.

### 3.3 Two "sites" layers — separation of concerns

- `api-worker/src/sites.ts` (Phase 1) — source of truth for site **config** (allowed origins, system prompt, allowed models, rate limits). **Unchanged.**
- `sites` table in Supabase (new, Phase 2) — RAG **state only** (status, chunk_count, last_indexed_at, knowledge_source). Written by ingestion CLI; read by api-worker at request time.

A site appears in both layers only if RAG is enabled. Phase 2: just `demo-public`. Phase 3: any site with `data-knowledge-url` set.

### 3.4 Supabase connection

`@supabase/supabase-js` v2. Uses `fetch` internally — Workers-compatible, no persistent TCP.

Two keys, separated by responsibility:
- **`SUPABASE_ANON_KEY`** → api-worker secret. Read-only in Phase 2. RLS disabled; row-level guards via explicit `site_id = ?` in every query.
- **`SUPABASE_SERVICE_ROLE_KEY`** → `ingestion/.env` only. Never deployed to Workers. Used for bulk insert/delete of chunks.

## 4. Request Flow Changes (`POST /chat`)

Phase 1 had an 8-step pipeline. Phase 2 inserts one new step (7a) between history wrapping and provider dispatch.

```
1. Site lookup                          (unchanged)
2. CORS check                           (unchanged)
3. Rate-limit gates (IP / origin / tokens)   (unchanged)
4. Input validation                     (unchanged)
5. History trim                         (unchanged)
6. Wrap user messages in <user_message> tags  (unchanged)
7a. [NEW] Optional RAG retrieval:
    - Check sites table for site.status = 'ready'
    - If not ready → skip (continue to step 7)
    - Embed the latest user message via OpenAI
    - Cosine search chunks (site_id = body.siteId, top-5)
    - Format as <context source="..." heading="...">...</context> blocks
    - Prepend context block before the system prompt
    - Any failure (Supabase down, embedding fails, timeout) → log warning, skip (fallback)
7. Provider dispatch                    (unchanged; uses possibly-augmented system prompt)
8. Stream + usage accounting            (unchanged)
```

### 4.1 Best-effort semantics

Retrieval is **never a hard dependency**:

- If Supabase is unreachable → log, proceed without RAG.
- If query embedding fails (OpenAI returns 5xx) → log, proceed without RAG.
- If retrieval returns zero chunks → proceed without RAG (chunks table is empty or site not indexed).
- If retrieval takes > 5000ms → timeout, proceed without RAG. (Original spec said 2000ms; observed cold-start embedding + Supabase round-trip routinely exceeds 2s, so the ceiling was raised after local smoke testing revealed the 2s budget killed grounded replies on first query.)

User-visible behavior: chat always works. Grounding is additive when available. This matches production RAG patterns and eliminates the failure-mode where a dependency outage kills the entire `/chat` endpoint.

### 4.2 What gets retrieved (query shape)

Only the **latest user message** is embedded. Earlier turns in the conversation are not used for retrieval.

Rationale: multi-turn query expansion (embed a summarized query) has real benefits but is its own design surface. Deferring to Phase 3 keeps Phase 2 honest and small.

### 4.3 Retrieval parameters

- **Top-k = 5** chunks.
- **No similarity threshold** — always return top-5, let the model judge via the system-prompt instruction "if the context doesn't contain the answer, say so".
- **Ordering:** highest cosine similarity first.
- **Total added tokens:** ≤ ~2500 (5 × 500-token chunks). Well within both provider model context limits.

## 5. Context Injection Format

`buildContextSystemPrompt(baseSystemPrompt, chunks)` produces:

```
You have access to context retrieved from the EmbedChat project documentation and source code. Use it to answer the user's question. Cite the source path where relevant (e.g. "per README.md"). If the context does not contain the answer, say you don't know rather than guessing.

<context source="README.md" heading="## Security > ### Rate limits">
Three KV-counter gates...
</context>

<context source="api-worker/src/routes/chat.ts" heading="export: chatRoute">
chatRoute.post("/", async (c) => { ... }
</context>

{baseSystemPrompt — for demo-public, the fixed prompt from sites.ts}
```

### 5.1 Prompt-injection defense (carried from Phase 1)

User messages in `body.messages` are still wrapped in `<user_message>...</user_message>` tags per Phase 1 §6.3. Retrieved chunks are NOT wrapped — they come from the indexed corpus (which the operator controls), not from untrusted input. The system prompt's injected instruction explicitly distinguishes: `<context>` = trusted operator content; `<user_message>` = untrusted user content.

### 5.2 Escaping rules

Each chunk's `content` is inserted verbatim. If content contains a literal `</context>` string (unlikely for markdown/TS but possible), it's escaped to `< /context>` — same mechanism as Phase 1's `</user_message>` escaping. Same 3-line function, reused.

## 6. Ingestion Pipeline

### 6.1 Package structure

```
ingestion/
├── package.json              # pnpm workspace; "ingest" script
├── tsconfig.json             # extends ../tsconfig.base.json; "node" types
├── bin/
│   └── ingest.ts             # CLI entry — argv parsing, orchestration
├── src/
│   ├── sources/
│   │   └── local-repo.ts     # reads files per allowlist
│   ├── chunk/
│   │   ├── markdown.ts       # markdown-aware recursive splitter
│   │   ├── typescript.ts     # top-level export splitter (uses typescript compiler API)
│   │   └── index.ts          # dispatches by extension
│   ├── embed/
│   │   └── openai.ts         # batched text-embedding-3-small calls
│   ├── store/
│   │   └── supabase.ts       # upsert sites row; delete + insert chunks
│   ├── tokenizer.ts          # js-tiktoken wrapper for token counts
│   ├── orchestrator.ts       # wires: crawl → chunk → embed → store
│   └── types.ts              # Chunk, Source, IngestConfig
├── test/                     # Vitest, node env
├── .env.example              # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
└── .gitignore                # .env
```

Node runtime, not Workers. `pnpm --filter=ingestion ingest` runs `node --experimental-strip-types bin/ingest.ts` (or via `tsx`, which is cleaner; plan decides).

### 6.2 CLI contract

```bash
pnpm ingest                    # default: full refresh of demo-public
pnpm ingest -- --dry-run       # crawl + chunk + token count, no embedding or DB write
pnpm ingest -- --file <path>   # re-ingest a single source file (for iteration)
```

**Idempotent by design.** Every full run wipes `chunks` for `demo-public` and reinserts. No incremental / diff logic in Phase 2.

### 6.3 Source allowlist

Hardcoded in `ingestion/src/sources/local-repo.ts`:

```ts
export const DEMO_SOURCES = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/DEPLOY.md",
  "docs/superpowers/specs/2026-04-21-embedchat-phase-1-design.md",
  "docs/superpowers/plans/2026-04-21-embedchat-phase-1.md",
  "docs/superpowers/specs/2026-04-21-embedchat-phase-2-design.md",
  "widget/src/config.ts",
  "widget/src/transport.ts",
  "widget/src/root.ts",
  "widget/src/store.ts",
  "api-worker/src/routes/chat.ts",
  "api-worker/src/routes/health.ts",
  "api-worker/src/prompt.ts",
  "api-worker/src/ratelimit.ts",
  "api-worker/src/llm/openai.ts",
  "api-worker/src/llm/anthropic.ts",
  "api-worker/src/llm/provider.ts",
  "api-worker/src/sites.ts",
];
```

~17 files. Phase 3 replaces this with a crawl function that takes a URL or Git URL.

### 6.4 Chunking rules

**Markdown files:**
1. Split on `##` / `###` headings. Each heading + body becomes a candidate chunk.
2. If a candidate > 500 tokens, split further by paragraph (double-newline).
3. If a paragraph-level chunk still > 500 tokens, split by sentence.
4. **Code blocks (\`\`\`) are atomic.** Never split across chunks. If a code block makes a chunk exceed 500 tokens, accept the overage — cap enforced at 1200 tokens hard max.
5. Build `heading_path` as breadcrumb: `# EmbedChat > ## Security > ### Rate limits`.

**TypeScript files:**
1. Parse with `typescript` compiler API (already a transitive dependency).
2. Each top-level `export function`, `export const`, `export class`, `export interface` becomes a chunk.
3. Attach the preceding JSDoc or line-comment block to the chunk.
4. Prepend a one-line prelude comment listing the file's imports, for LLM context:
   `// from api-worker/src/routes/chat.ts, imports: Hono, getSite, buildMessages, ...`
5. `heading_path` = `<relative_path> > export: <symbol_name>`.

**Other files:** fail with a clear error. No silent fallback — we only accept content we know how to chunk well.

### 6.5 Embedding

OpenAI `text-embedding-3-small`. Batch up to 50 chunks per request. One retry with exponential backoff on 429/5xx, then fail the ingest. For a ~50-chunk corpus: 1-2 requests total, < $0.001 per run.

### 6.6 Store phase

```ts
// Pseudocode, in ingestion/src/store/supabase.ts
export async function storeChunks(siteId: string, chunks: Chunk[]) {
  await sb.from('sites').upsert({
    site_id: siteId,
    name: 'Demo (EmbedChat repo)',
    knowledge_source: 'github.com/brightnwokoro/embedchat-widget',
    status: 'indexing',
  });
  await sb.from('chunks').delete().eq('site_id', siteId);
  await sb.from('chunks').insert(chunks);    // single batched insert
  await sb.from('sites').update({
    status: 'ready',
    chunk_count: chunks.length,
    last_indexed_at: new Date().toISOString(),
  }).eq('site_id', siteId);
}
```

Partial failures: if any step fails, `sites.status` remains `'indexing'` or flips to `'failed'` via the catch block. The api-worker's retrieval gate (`status = 'ready'`) guarantees partial data is never served. A clean re-run fixes.

## 7. Testing

### 7.1 Ingestion package

Vitest, node env, no Workers. Fast unit tests:

| Module | Tests |
|---|---|
| `chunk/markdown.ts`  | Header-based splitting; code blocks atomic; `heading_path` breadcrumbs; 500-token splitting when sections are large |
| `chunk/typescript.ts`| One chunk per exported symbol; comments attached; imports prelude; symbol-name in heading_path |
| `tokenizer.ts`       | js-tiktoken counts match known strings for `cl100k_base` encoding |
| `orchestrator.ts`    | End-to-end with stubbed fetch + stubbed Supabase: given fixtures, produces expected insert calls |

Not unit-tested:
- OpenAI embedding network calls (covered by manual smoke: `pnpm ingest --dry-run` shows chunk counts; full `pnpm ingest` verifies end-to-end against a real Supabase test project).
- Supabase insert at the HTTP level (covered by the end-to-end run).

### 7.2 api-worker RAG modules

Vitest via `@cloudflare/vitest-pool-workers` (Miniflare), existing pattern from Phase 1:

| Module | Tests |
|---|---|
| `rag/embed-query.ts` | OpenAI fetch shape; long-query handling; empty-query rejection |
| `rag/retrieve.ts`    | Supabase fetch shape; parses results; orders by similarity; empty-result handling |
| `rag/context.ts`     | Context block formatting; `</context>` escaping; empty chunks → prompt unchanged; source/heading fields populated |
| `routes/chat.ts`     | (augmented) Full path when `status='ready'` → system prompt contains `<context>`; when `status!='ready'` → ungrounded; when Supabase fetch fails → graceful fallback, no 500 |

All Phase 1 api-worker tests continue to pass. After Phase 2: ≥30 api-worker tests.

### 7.3 E2E

The existing `api-worker/test/e2e.test.ts` is extended, not duplicated: stubs Supabase fetch + asserts that a known query against a canned `chunks` result produces a system prompt containing those chunks' content. Still one e2e test.

### 7.4 Ingestion library fixtures

`ingestion/test/fixtures/`:
- `sample.md` — contains headings, paragraphs, code blocks with known structure
- `sample.ts` — contains ≥ 2 exported symbols with JSDoc

These drive both the markdown and typescript chunker tests.

## 8. Environment & Secrets

### 8.1 api-worker additions

Two new Workers secrets via `wrangler secret put`:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Updated `api-worker/worker-configuration.d.ts`:

```ts
export interface Env {
  RATE_LIMIT: KVNamespace;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ENVIRONMENT: string;
}
```

`api-worker/.dev.vars.example` updated to include the two new vars.

### 8.2 ingestion package

`ingestion/.env.example`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=sk-...
```

`.env` gitignored. Uses `dotenv` for local load.

## 9. Repository Structure (additions)

```
embedchat-widget/
├── (Phase 1 packages — unchanged)
├── pnpm-workspace.yaml                  (add: ingestion)
├── package.json                         (add: "ingest": "pnpm --filter=ingestion ingest")
├── ingestion/                           NEW
│   ├── bin/ingest.ts
│   ├── src/
│   │   ├── sources/local-repo.ts
│   │   ├── chunk/{markdown,typescript,index}.ts
│   │   ├── embed/openai.ts
│   │   ├── store/supabase.ts
│   │   ├── tokenizer.ts
│   │   ├── orchestrator.ts
│   │   └── types.ts
│   ├── test/
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── supabase/                            NEW
│   └── schema.sql
└── api-worker/src/
    ├── rag/                             NEW (inside existing package)
    │   ├── embed-query.ts
    │   ├── retrieve.ts
    │   ├── context.ts
    │   └── types.ts
    ├── supabase.ts                      NEW (thin client factory)
    └── routes/chat.ts                   MODIFIED (step 7a insertion)
```

## 10. Documentation Updates

### 10.1 README

- Add "Phase 2 — shipped" note at top of Roadmap.
- Add a short "RAG grounding" section explaining: demo is grounded on repo, questions cite sources, retrieval is best-effort.
- Update "What Phase 1 ships" list to note Phase 2 additions.

### 10.2 docs/ARCHITECTURE.md

- Add a Phase 2 request-sequence diagram showing step 7a (Supabase round-trip).
- Add Supabase to the services block.
- Update the file map with `rag/`, `ingestion/`, `supabase/schema.sql`.

### 10.3 docs/DEPLOY.md

New section: "Supabase setup" covering:
1. Create free-tier Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor.
3. Set Workers secrets on api-worker (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
4. Populate `ingestion/.env` with the service-role key + OpenAI key.
5. Run `pnpm ingest` once. Verify `select status, chunk_count from sites;` shows `ready` and a plausible count.
6. Redeploy api-worker.

## 11. Success Criteria (Definition of Done)

Phase 2 is complete when **all** of these hold:

1. `pnpm --filter=ingestion ingest` against a fresh Supabase project populates ≥ 40 chunks for `demo-public`. `sites.status` = `'ready'`, `chunk_count` matches.
2. `pnpm test` passes across all workspaces. Widget: 28 (unchanged). api-worker: ≥ 30 (was 21). ingestion: ≥ 10 new.
3. `pnpm build` succeeds; widget bundle ≤ 35kb gzipped (unchanged).
4. Locally (api-worker + Supabase configured): asking "how does rate limiting work?" through the widget produces a grounded reply citing `api-worker/src/ratelimit.ts` or `README.md > ## Security > ### Rate limits`.
5. Locally with a deliberately wrong `SUPABASE_URL`: chat still works. No 500. Warning logged server-side.
6. `docs/DEPLOY.md` has the Supabase section; someone following it end-to-end can reproduce the grounded demo.
7. README, ARCHITECTURE.md, and the "Phase 2 — shipped" checklist are updated.
8. Live deploy (post-Phase-2): `embedchat-demo.brightnwokoro.dev` answers repo-specific questions with visible retrieval. Eyeball check.

## 12. Open Questions

None. Noted for the record:

- Phase 3 will eventually add RLS policies and an `ingest-worker`. Phase 2's schema and the ingestion library are designed to support that without changes; only additions.
- The 500-token target for chunks is calibrated for the current corpus. If retrieval quality proves weak (top-5 misses obvious matches), the first knob to turn is chunking boundaries, then consider reranking.
- `text-embedding-3-small` at 1536 dims. Swapping to `3-large` (3072 dims) or Voyage is a schema-breaking change (vector column type) — intentional friction; not a silent migration.

## 13. Phase 3 pointers

Not designed here, but Phase 2 architecture explicitly preserves room for:

- **Arbitrary-site `data-knowledge-url`.** Widget already parses and stores the value (Phase 1). Phase 3 wires an `ingest-worker` that reuses `ingestion/src/` as a library, crawls the URL (sitemap-aware), chunks, embeds, stores. The same retrieval path in api-worker works unchanged.
- **RLS policies.** `sites.site_id` as the tenant boundary. Phase 3 adds policies that restrict read access by a claim in the JWT or a per-site key.
- **Reranking** as a post-retrieval layer if corpus grows past ~500 chunks per site.
- **Query logging + analytics.** A new `queries` table; api-worker logs retrieval results and user ratings.
- **Delta ingestion** (re-embed only changed sources) once corpora grow large enough that full-refresh cost matters.

Each gets its own spec + plan + implementation cycle.
