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
