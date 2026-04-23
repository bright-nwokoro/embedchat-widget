# Deployment Runbook — Phase 1

This walks through one-time setup and each `pnpm deploy` cycle.

## One-time setup

### 1. Cloudflare account + wrangler

```bash
pnpm install -g wrangler
wrangler login
```

### 2. Create the KV namespace for rate limiting

```bash
wrangler kv namespace create RATE_LIMIT
wrangler kv namespace create RATE_LIMIT --preview
```

Copy both IDs into `api-worker/wrangler.toml`, replacing the `REPLACE_WITH_KV_NAMESPACE_ID` placeholders:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "<production id>"
preview_id = "<preview id>"
```

### 3. Set API keys as Workers secrets

```bash
cd api-worker
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

### 4. Create the Pages project

```bash
cd demo
wrangler pages project create embedchat-demo
```

### 5. DNS — point the three subdomains at Cloudflare

In the Cloudflare dashboard for `brightnwokoro.dev`:

| Subdomain | Record | Target |
|---|---|---|
| `embedchat-demo` | CNAME | `embedchat-demo.pages.dev` (proxy ON) |
| `embedchat-cdn`  | Worker route | `embedchat-cdn.brightnwokoro.dev/*` → `embedchat-cdn` worker |
| `embedchat-api`  | Worker route | `embedchat-api.brightnwokoro.dev/*` → `embedchat-api` worker |

Workers routes are set under Workers & Pages → the worker → Settings → Triggers → Routes.

### 6. Add custom domains to Pages

In Pages → `embedchat-demo` → Custom domains → add `embedchat-demo.brightnwokoro.dev`.

## Recurring deploys

From the repo root:

```bash
pnpm install
pnpm test
pnpm build
pnpm deploy
```

`pnpm deploy` runs:
1. `wrangler deploy` on api-worker
2. `wrangler deploy` on cdn-worker (rebuilds widget + inlines bundle first)
3. `wrangler pages deploy demo/dist --project-name=embedchat-demo`

## Verifying

```bash
curl https://embedchat-api.brightnwokoro.dev/health
# expect: {"ok":true,"providers":{"openai":"configured","anthropic":"configured"},...}

curl -I https://embedchat-cdn.brightnwokoro.dev/embedchat.js
# expect: 200 + content-type: application/javascript + cache-control: ...immutable

curl https://embedchat-demo.brightnwokoro.dev/
# expect: HTML containing "EmbedChat"
```

Visit the demo URL in a browser and send a test message.

## Rotating API keys

```bash
cd api-worker
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

## Cost ceiling

The `demo-public` daily token budget is 500,000. At worst-case pricing (Claude Haiku 4.5 at $5/1M output) that caps spend at ~$2.50/day. To change, edit `LIMITS.DAILY_TOKEN_BUDGET` in `api-worker/src/ratelimit.ts` and redeploy.

## Supabase setup (Phase 2)

RAG grounding requires a Supabase Postgres project with pgvector.

### 1. Create the project

1. Go to https://supabase.com and create a new project (free tier is sufficient).
2. Note three values from Settings → API:
   - `Project URL` (`SUPABASE_URL`)
   - `anon` public key (`SUPABASE_ANON_KEY`)
   - `service_role` secret key (`SUPABASE_SERVICE_ROLE_KEY`)

### 2. Apply the schema

In the SQL Editor, paste the contents of `supabase/schema.sql` and run. Verify:

```sql
select * from sites;  -- empty
select count(*) from chunks;  -- 0
select proname from pg_proc where proname = 'match_chunks';  -- returns match_chunks
-- RLS is explicitly disabled by the schema (required so anon-key reads work);
-- confirm with:
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('sites','chunks');
-- both rows should show rowsecurity = false.
```

**If `rowsecurity = true` on either table** (Supabase auto-enables RLS on some project templates), re-run the schema — it includes explicit `disable row level security` statements. Without this, the api-worker's anon-key reads return empty and chat silently falls back to ungrounded.

### 3. Configure ingestion

```bash
cp ingestion/.env.example ingestion/.env
# Edit ingestion/.env with your three Supabase values + OPENAI_API_KEY
```

Keys in `.env`:
- `SUPABASE_URL` (same as above)
- `SUPABASE_SERVICE_ROLE_KEY` (for bulk writes — never deploy this to Workers)
- `OPENAI_API_KEY`

### 4. Run ingestion

```bash
pnpm ingest
```

Expected: a summary line reporting chunk count. Verify in Supabase:

```sql
select status, chunk_count, last_indexed_at from sites where site_id = 'demo-public';
```

Should show `ready`, a chunk count ≥ 40, and a recent timestamp.

### 5. Add Supabase secrets to api-worker

```bash
cd api-worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
```

Note: use the **anon** key for api-worker (read-only path), not the service role.

### 6. Redeploy

```bash
pnpm deploy
```

### 7. Verify grounded responses

Visit the live demo and ask "how does rate limiting work?" — the response should mention specific sources (e.g. `api-worker/src/ratelimit.ts`).

### Refreshing the knowledge base

Whenever the repo changes, re-run `pnpm ingest`. It's idempotent: chunks for `demo-public` are wiped and reinserted on every run.

### Graceful degradation

If Supabase becomes unreachable, `/chat` falls back to ungrounded responses — no 500s, no user-visible error. Verify with `curl https://embedchat-api.brightnwokoro.dev/chat -d '...'` while `SUPABASE_URL` points somewhere bogus.

## Phase 3a deployment (Dynamic RAG)

Adds the `ingest-worker` Worker, a Queue, and schema changes.

### 1. Create Cloudflare Queues

```bash
wrangler queues create embedchat-ingest
wrangler queues create embedchat-ingest-dlq
```

### 2. Apply Supabase migration

In Supabase SQL Editor, paste the contents of `supabase/migrations/2026-04-22-phase-3a.sql` and run. Verify:

```sql
select column_name from information_schema.columns
where table_name = 'sites' and column_name = 'allowed_origins';
-- one row; column exists.

select rowsecurity from pg_tables where tablename in ('sites','chunks');
-- both = true; RLS re-enabled.

select status, allowed_origins, system_prompt from sites where site_id = 'demo-public';
-- status=ready, allowed_origins={'*'}, system_prompt populated.
```

### 3. Rotate api-worker secrets

```bash
cd api-worker
openssl rand -hex 32
# copy value, then:
wrangler secret put ADMIN_API_KEY

wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# old SUPABASE_ANON_KEY is no longer used; can be deleted from Cloudflare dashboard.
```

### 4. Deploy ingest-worker

```bash
cd ../ingest-worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put OPENAI_API_KEY
wrangler deploy
```

### 5. Deploy api-worker (with new code + new secrets)

```bash
cd ..
pnpm deploy
```

Order note: apply the migration (step 2) BEFORE redeploying api-worker (step 5). Between those two steps the live api-worker still uses the old code + ANON_KEY against an RLS-enabled DB — chat breaks briefly (< 60s in practice).

### 6. Register your first site

Add to `ingestion/.env`:

```
API_URL=https://embedchat-api.brightnwokoro.dev
ADMIN_API_KEY=<same value you passed to wrangler secret put>
```

Register:

```bash
pnpm register-site \
  --site-id phase-3a-test \
  --name "Phase 3a test" \
  --knowledge-url https://brightnwokoro.dev/sitemap.xml \
  --system-prompt "You are a portfolio assistant for Bright Nwokoro." \
  --allowed-origins https://brightnwokoro.dev,http://localhost:8080
```

Expected: 202 Accepted within 1s.

```bash
pnpm register-site --status phase-3a-test
```

Within 2 min: `status: "ready"` with chunk_count > 0.
