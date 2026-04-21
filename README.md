# EmbedChat

> A drop-in AI chat widget for any website. One `<script>` tag, Shadow-DOM isolated, configured by data-attributes. ~3.6kb gzipped. Phase 2 adds RAG grounding — the demo is a bot that knows the EmbedChat codebase.

**🔗 Live demo:** [https://embedchat-demo.brightnwokoro.dev](https://embedchat-demo.brightnwokoro.dev)
**👤 Built by:** [Bright Nwokoro](https://brightnwokoro.dev) · [hello@brightnwokoro.dev](mailto:hello@brightnwokoro.dev)

> **Phase 1** of a phased build. Widget + streaming LLM backend + live demo. RAG grounding, admin UI, and other roadmap items are Phase 2 / Phase 3 — see `[docs/superpowers/specs/](docs/superpowers/specs/)` for the design arc and `[docs/superpowers/plans/](docs/superpowers/plans/)` for the executed plan.

---

## Why this exists

Every SaaS founder wants an AI chat bubble on their site. Existing options are bad in different ways:

- **Big chat platforms** (Intercom + AI add-ons) — $100+/month, heavy bundle, requires full auth integration.
- **Open-source chat components** — good starting points but require the host site to own styling, backend, and LLM keys.
- **"Build it yourself"** — another two weeks of work per client before anyone sees anything.

EmbedChat is the productized middle path. The site owner pastes one `<script>` tag, sets a primary color and a greeting via data-attributes, and ships an AI chat experience in under a minute. Shadow DOM guarantees zero CSS collision with the host site. A small edge-deployed backend proxies to the LLM so API keys never leave the server.

## What Phase 1 ships

- **One-line install** — paste a `<script>` tag, widget appears
- **Shadow DOM isolation** — host-site CSS can't leak in, widget CSS can't leak out
- **Config via `data-`* attributes** — primary color, greeting, position, model
- **Streaming responses** — token-by-token rendering via Server-Sent Events
- **Multi-provider backend** — OpenAI `gpt-4o-mini` or Anthropic `claude-haiku` via a `data-model` toggle
- **Server-side LLM proxy** — the widget never sees the API key
- **Prompt-injection defense** — user messages wrapped in `<user_message>...</user_message>` tags; system prompt instructs the model to treat tagged content as untrusted data
- **Abuse-resistant public demo** — per-IP, per-origin, and per-day token-budget rate limits on the shared `demo-public` site-id
- **~3.6kb gzipped** — no React, no Vue, no framework tax on the host page
- **CI-enforced bundle size** — pull requests blow up if the bundle exceeds 35kb gzipped

## Architecture

Three Cloudflare deploys, one subdomain each under `brightnwokoro.dev`:

```
  Host site
  ┌─────────────────────────┐
  │ <script                 │
  │   src=".../embedchat.js"│         ┌─────────────────────────────────┐
  │   data-site-id=…        │────────▶│ embedchat-cdn.brightnwokoro.dev │
  │   data-api-url=…      ▶ │         │ Worker — serves bundle          │
  │ />                      │         │ cache: 1yr immutable            │
  │                         │         └─────────────────────────────────┘
  │  ┌─── Shadow DOM ───┐   │         ┌─────────────────────────────────┐
  │  │ Bubble + Panel   │   │         │ embedchat-api.brightnwokoro.dev │
  │  │ (vanilla TS)     │◀──┼─── SSE ─│ Hono app — /chat + /health      │
  │  └──────────────────┘   │         │  ├ CORS                         │
  └─────────────────────────┘         │  ├ KV rate limits               │
                                      │  ├ Prompt-injection wrap        │
                                      │  └ Provider dispatch ──┐        │
                                      └──────────────────────┬─┴────────┘
                                                             ▼
                                         ┌────────────────────────────┐
                                         │ OpenAI `gpt-4o-mini`  OR   │
                                         │ Anthropic `claude-haiku`   │
                                         └────────────────────────────┘
```

- **Widget** is vanilla TypeScript, rendered inside a Shadow Root attached to a single floating container. All internal CSS uses `:host` selectors.
- **api-worker** is a Hono app deployed to Cloudflare Workers. It owns the LLM keys, applies the per-site system prompt, and streams responses via SSE.
- **cdn-worker** is a tiny Worker that serves `embedchat.js` with long-cache immutable headers and open CORS.
- **demo** is a single-page static site on Cloudflare Pages.

## Stack


| Layer       | Tech                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| Widget      | Vanilla TypeScript 5, Shadow DOM, esbuild                                         |
| Backend     | Hono 4, TypeScript, Cloudflare Workers runtime                                    |
| LLM         | OpenAI `gpt-4o-mini` default, Anthropic `claude-haiku` toggle                     |
| Rate limits | Workers KV (per-IP, per-origin, per-day token budget)                             |
| Streaming   | Server-Sent Events                                                                |
| CDN         | Cloudflare Workers (bundle) + Cloudflare Pages (demo page)                        |
| Testing     | Vitest + jsdom (widget), @cloudflare/vitest-pool-workers / Miniflare (api-worker) |


## Quick start

### Use the hosted widget

```html
<script
  src="https://embedchat-cdn.brightnwokoro.dev/embedchat.js"
  data-site-id="demo-public"
  data-api-url="https://embedchat-api.brightnwokoro.dev"
  data-primary-color="#7C5CFF"
  data-greeting="Hi — ask me anything."
  defer
></script>
```

The `demo-public` site-id is rate-limited for public use (20 req/IP/10min, 200 req/origin/day, 500k-token global daily budget). For your own quotas or a branded system prompt, clone the repo and deploy your own backend.

### Self-host

```bash
git clone https://github.com/brightnwokoro/embedchat-widget
cd embedchat-widget

pnpm install
pnpm test         # 49 tests: 28 widget + 21 api-worker
pnpm build        # widget bundle + Workers dry-run + static demo copy
```

Then follow `[docs/DEPLOY.md](docs/DEPLOY.md)` to set up Cloudflare DNS, Workers secrets, and KV.

## Data attributes (Phase 1 reference)


| Attribute            | Required | Default                 | Purpose                                                                     |
| -------------------- | -------- | ----------------------- | --------------------------------------------------------------------------- |
| `data-site-id`       | ✅        | —                       | Tenant identifier (`demo-public` for the shared demo)                       |
| `data-api-url`       | ✅        | —                       | Base URL of the api-worker (e.g. `https://embedchat-api.brightnwokoro.dev`) |
| `data-primary-color` |          | `#7C5CFF`               | Bubble + accent color (any valid `#rgb` or `#rrggbb`)                       |
| `data-greeting`      |          | `"Hi, how can I help?"` | First-message copy                                                          |
| `data-system-prompt` |          | Fixed demo prompt       | Per-site LLM persona (ignored for `demo-public`)                            |
| `data-position`      |          | `bottom-right`          | `bottom-left` or `bottom-right`                                             |
| `data-model`         |          | `gpt-4o-mini`           | `gpt-4o-mini` or `claude-haiku`                                             |
| `data-max-messages`  |          | `30`                    | Rolling client-side history limit                                           |
| `data-avatar-url`    |          | —                       | Custom bot avatar (accepted but unused in Phase 1)                          |
| `data-knowledge-url` |          | —                       | Accepted and logged; RAG grounding ships in Phase 2                         |


## Project structure

```
embedchat-widget/
├── widget/                          # ~3.6kb gzipped embeddable bundle
│   ├── src/
│   │   ├── index.ts                 # entry; reads data-* and boots widget
│   │   ├── root.ts                  # Shadow DOM setup + send controller
│   │   ├── config.ts                # data-* parsing + validation
│   │   ├── store.ts                 # pub/sub message + UI state
│   │   ├── transport.ts             # SSE stream parser
│   │   ├── styles.ts                # :host-scoped CSS
│   │   └── ui/                      # Bubble, Panel, MessageList, Composer
│   ├── test/                        # 28 Vitest tests
│   └── esbuild.config.mjs
├── api-worker/                      # Hono app on Cloudflare Workers
│   ├── src/
│   │   ├── index.ts                 # Hono app + routes wire-up
│   │   ├── routes/chat.ts           # SSE chat pipeline
│   │   ├── routes/health.ts         # /health probe
│   │   ├── sites.ts                 # site registry (demo-public)
│   │   ├── prompt.ts                # <user_message> wrapping
│   │   ├── ratelimit.ts             # KV counters
│   │   └── llm/                     # provider interface + openai + anthropic
│   ├── test/                        # 21 Miniflare-backed tests
│   └── wrangler.toml
├── cdn-worker/                      # serves embedchat.js with immutable cache
├── demo/                            # static landing page (Cloudflare Pages)
├── .github/workflows/ci.yml         # typecheck + tests + bundle-size ceiling
└── docs/
    ├── DEPLOY.md                    # Cloudflare + DNS + secrets runbook
    ├── ARCHITECTURE.md              # request diagrams + file map
    └── superpowers/
        ├── specs/2026-04-21-embedchat-phase-1-design.md
        └── plans/2026-04-21-embedchat-phase-1.md
```

## How it works

### Widget lifecycle

1. Host page parses the `<script>` tag; `index.ts` reads all `data-*` attributes via `document.currentScript`.
2. A single `<div>` container is attached to `document.body`; a Shadow Root (open mode) is attached.
3. All widget UI renders inside the Shadow Root; styles use `:host {}` and local selectors — zero leakage either direction.
4. User clicks the bubble → panel opens → messages stream from the api-worker over SSE.

### api-worker request path (POST /chat)

```
1. Site lookup      — resolve siteId against sites.ts registry (404 if unknown)
2. CORS check       — origin vs. site.allowedOrigins (wildcard for demo-public)
3. Rate-limit gates — KV counters: per-IP, per-origin, per-day tokens (any one trips → 429)
4. Validate         — message length, role enum, model enum, history length
5. History trim     — clamp to site.maxHistoryTurns
6. Prompt wrap      — every user message wrapped in <user_message>…</user_message>
7. Provider stream  — OpenAI Chat Completions or Anthropic Messages, both via fetch + SSE
8. SSE out          — data: {"t":"token","v":"..."}; finally data: {"t":"done","usage":...}
9. Usage accounting — post-stream, increment daily token budget in KV
```

## Security

- **API key isolation** — LLM keys live on the api-worker as Workers secrets; the widget never sees them.
- **Site-ID scoping** — every request resolves against the site registry; `demo-public` has hard-coded constraints (open CORS but fixed system prompt, short output cap, conversation-length clamp).
- **Rate limits** — per IP (20 / 10 min), per origin (200 / day), and a global 500k-token daily budget. Any gate trips → 429.
- **Prompt injection defense** — user messages are wrapped in `<user_message>...</user_message>` tags; the system prompt instructs the model to treat tagged content as data. Not a security guarantee but meaningfully raises the bar.
- **XSS safe rendering** — message content is set via `textContent`, never `innerHTML`. Widget never evaluates content from the network.
- **CSP friendly** — no `eval`, no inline styles outside the Shadow Root.

## RAG grounding (Phase 2)

The `demo-public` site-id is grounded on the EmbedChat repo itself. Ask the demo bot things like "how does rate limiting work?" or "what's in chat.ts?" — it retrieves from the indexed codebase and cites sources.

- **Ingestion** is a local CLI (`pnpm ingest`): crawls a hardcoded source allowlist (README, specs, selected source files), chunks with Markdown/TypeScript awareness, embeds with OpenAI `text-embedding-3-small`, upserts to Supabase pgvector.
- **Retrieval** happens inside `/chat`: embed the latest user message, top-5 cosine search, inject `<context>` blocks into the system prompt.
- **Best-effort**: if Supabase is unreachable, chat falls back to ungrounded responses. No 500s, no hard dependency.

Deploy this for your own site: see [`docs/DEPLOY.md`](docs/DEPLOY.md#supabase-setup-phase-2).

## Cost profile

For a typical demo at ~500 questions/day:


| Item                           | Monthly cost (USD) |
| ------------------------------ | ------------------ |
| Cloudflare Workers (free tier) | $0                 |
| Cloudflare Pages (free tier)   | $0                 |
| LLM inference (`gpt-4o-mini`)  | ~$15               |
| **Total**                      | **~$15/month**     |


The daily token budget caps worst-case abuse spend at ~$2.50/day on the most expensive configured model.

## Deployment

**Widget bundle:** served from a small Worker (`cdn-worker`) at `embedchat-cdn.brightnwokoro.dev` with `Cache-Control: public, max-age=31536000, immutable`.
**Backend:** `wrangler deploy` to Cloudflare Workers at `embedchat-api.brightnwokoro.dev`.
**Demo site:** `wrangler pages deploy` to `embedchat-demo.brightnwokoro.dev`.

Full runbook in `[docs/DEPLOY.md](docs/DEPLOY.md)`.

## Roadmap

Phase 1 and Phase 2 ship today:
- ✅ **Phase 1** — Widget + streaming LLM backend + demo site.
- ✅ **Phase 2** — **RAG grounding**: `demo-public` is grounded on the EmbedChat repo itself via Supabase pgvector. Ask about rate limits or the chat route, and the bot cites specific source files.

Phase 3 adds:
- [ ] Arbitrary-site RAG via `data-knowledge-url` — ingest-worker + crawler, same retrieval path.
- [ ] Admin UI for named site-ids with per-site system prompts + origin allowlists.
- [ ] Conversation persistence, analytics, lead capture, handoff-to-human.
- [ ] Per-site custom fonts loaded via Shadow DOM.
- [ ] Multi-language auto-detect.

## Contributing

Issues and PRs welcome. Widget bundle size is a hard commitment: any change that bumps it above 35kb gzipped needs a strong justification in the PR.

## License

MIT — see [LICENSE](LICENSE).

## Contact

Freelance AI engineering — RAG, chat widgets, AI copilots, end-to-end.
**Email:** [hello@brightnwokoro.dev](mailto:hello@brightnwokoro.dev)
**Portfolio:** [https://brightnwokoro.dev](https://brightnwokoro.dev)
**Book a call:** [https://calendly.com/brightnwokoro/30min](https://calendly.com/brightnwokoro/30min)