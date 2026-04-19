# EmbedChat

> A drop-in AI chat widget for any website. One `<script>` tag, Shadow-DOM isolated, configured by data-attributes. ~30kb bundled.

**🔗 Live demo:** https://embedchat-demo.brightnwokoro.dev
**👤 Built by:** [Bright Nwokoro](https://brightnwokoro.dev) · [hello@brightnwokoro.dev](mailto:hello@brightnwokoro.dev)

![EmbedChat demo](./docs/demo.gif)

---

## Why this exists

Every SaaS founder wants an AI chat bubble on their site. The options today are bad in different ways:

- **Big chat platforms** (Intercom + AI add-ons) — $100+/month, heavy bundle, requires full auth integration.
- **Open-source chat components** — good starting points but require the host site to own styling, backend, and LLM keys.
- **"Build it yourself"** — another two weeks of work per client before anyone sees anything.

EmbedChat is the productized middle path. The site owner pastes one `<script>` tag, sets a primary color and a system prompt via data-attributes, and ships an AI chat experience in under a minute. Shadow DOM guarantees zero CSS collision with the host site. A small edge-deployed backend proxies to the LLM so API keys never leave the server.

Pitched as a $1.5k–$5k productized offer; demo site shows what "installed" looks like so the sale is 80% closed before the first reply.

## What it does

- **One-line install** — paste a `<script>` tag, widget appears
- **Shadow DOM isolation** — host-site CSS can't leak in, widget CSS can't leak out
- **Config via `data-*` attributes** — primary color, greeting, system prompt, knowledge source URL
- **Streaming responses** — token-by-token rendering via Server-Sent Events
- **Optional RAG grounding** — point `data-knowledge-url` at a sitemap / Notion export / docs URL, and the backend ingests + indexes it on first install
- **Server-side LLM proxy** — the widget never sees the API key
- **~30kb minified** — no React, no Vue, no framework tax on the host page

## Architecture

```
  Host site
  ┌─────────────────────────┐
  │ <script                 │
  │   src=".../embedchat.js"│         ┌────────────────┐
  │   data-primary-color…   │────────▶│ Cloudflare     │
  │   data-system-prompt… ▶ │   SSE   │ Workers edge   │────┐
  │ />                      │         │ backend (Hono) │    │
  │                         │         └────────────────┘    │
  │  ┌─── Shadow DOM ───┐   │                               │
  │  │ Chat bubble UI   │   │         ┌────────────────┐    │
  │  │ (vanilla TS)     │   │         │ OpenAI / Claude│◀───┘
  │  └──────────────────┘   │         └────────────────┘
  └─────────────────────────┘                ▲
                                             │ (optional)
                                      ┌──────┴───────┐
                                      │  Postgres +  │
                                      │   pgvector   │
                                      │  (RAG grnd.) │
                                      └──────────────┘
```

- **Widget** is vanilla TypeScript, rendered inside a Shadow Root attached to a single floating container. All internal CSS uses `:host` selectors.
- **Backend** is a Hono app deployed to Cloudflare Workers. It owns the LLM key, applies the per-site system prompt, and streams responses back to the widget via SSE.
- **RAG grounding** (optional) — when `data-knowledge-url` is set, the backend crawls + chunks + embeds the source on first install and stores vectors in a shared Postgres + pgvector cluster, scoped by site ID.

## Stack

| Layer       | Tech                                                 |
| ----------- | ---------------------------------------------------- |
| Widget      | Vanilla TypeScript 5, Shadow DOM, esbuild            |
| Backend     | Hono 4, TypeScript, Cloudflare Workers runtime       |
| LLM         | OpenAI `gpt-4o-mini` default, Claude `haiku` toggle  |
| Vector DB   | Postgres 16 + pgvector 0.7 (shared tenant-scoped)    |
| Streaming   | Server-Sent Events                                   |
| CDN         | Cloudflare (script) + R2 (bundle assets)             |

## Quick start

### Use the hosted widget

```html
<script
  src="https://cdn.embedchat.dev/embedchat.js"
  data-primary-color="#7C5CFF"
  data-greeting="Hi — ask me anything about Acme."
  data-system-prompt="You are Acme's support assistant. Be concise."
  data-knowledge-url="https://acme.com/sitemap.xml"
  defer
></script>
```

### Self-host

```bash
git clone https://github.com/bright-nwokoro/embedchat-widget
cd embedchat-widget

# Widget bundle
cd widget
pnpm install
pnpm build                       # outputs dist/embedchat.js (~30kb)

# Backend
cd ../backend
cp .env.example .dev.vars        # fill OPENAI_API_KEY, DATABASE_URL
pnpm install
pnpm dev                         # http://localhost:8787
```

Then serve the widget bundle from your CDN and point `<script src>` at it.

## Data attributes (full reference)

| Attribute              | Required | Default                     | Purpose                                |
| ---------------------- | -------- | --------------------------- | -------------------------------------- |
| `data-site-id`         | ✅       | —                           | Tenant identifier for this install     |
| `data-primary-color`   |          | `#7C5CFF`                   | Bubble + accent color                  |
| `data-greeting`        |          | `"Hi, how can I help?"`     | First-message copy                     |
| `data-system-prompt`   |          | Generic assistant prompt    | Per-site LLM persona and rules         |
| `data-knowledge-url`   |          | —                           | Optional URL to ingest for RAG grounding |
| `data-position`        |          | `bottom-right`              | `bottom-left`, `bottom-right`          |
| `data-model`           |          | `gpt-4o-mini`               | `gpt-4o-mini`, `claude-haiku`          |
| `data-max-messages`    |          | `30`                        | Rolling history limit                  |
| `data-avatar-url`      |          | —                           | Custom bot avatar                      |

## Project structure

```
embedchat-widget/
├── widget/
│   ├── src/
│   │   ├── index.ts              # entry; reads data-* and boots widget
│   │   ├── root.ts               # Shadow DOM setup
│   │   ├── ui/
│   │   │   ├── Bubble.ts
│   │   │   ├── Panel.ts
│   │   │   └── MessageList.ts
│   │   ├── transport.ts          # SSE stream parser
│   │   └── styles.ts             # injected :host CSS
│   ├── esbuild.config.mjs
│   └── dist/embedchat.js
├── backend/
│   ├── src/
│   │   ├── index.ts              # Hono app + routes
│   │   ├── routes/
│   │   │   ├── chat.ts           # SSE chat endpoint
│   │   │   ├── ingest.ts         # crawl + index knowledge source
│   │   │   └── admin.ts          # site + knowledge management
│   │   ├── llm.ts                # OpenAI/Claude providers
│   │   ├── rag.ts                # retrieval helpers
│   │   └── db.ts                 # pgvector queries
│   └── wrangler.toml
├── docs/
│   ├── DEPLOY.md
│   └── demo.gif
└── README.md
```

## How it works

### Widget lifecycle

1. Host page parses the `<script>` tag; `index.ts` reads all `data-*` attributes.
2. A single `<div>` container is attached to `document.body`; a Shadow Root is created inside it.
3. All widget UI renders inside the Shadow Root; styles use `:host {}` and local selectors.
4. User clicks the bubble → panel opens → messages stream from backend over SSE.

### Backend request path

```
POST /chat
{
  "siteId": "...",
  "messages": [...],
  "systemPrompt": "...",
  "model": "gpt-4o-mini",
  "knowledgeUrl": "..."   // if RAG enabled
}
```

1. Validate + rate-limit per site ID.
2. If `knowledgeUrl` is set and the site has ingested knowledge, retrieve top-k chunks via pgvector and inject them into the system prompt.
3. Stream LLM response via SSE; widget parses token-by-token.

### RAG grounding (optional)

When a site first installs with `data-knowledge-url`:
- Backend fetches the URL (sitemap.xml, Notion export, or docs URL).
- Crawls up to N pages respecting robots.txt.
- Chunks + embeds + stores in Postgres scoped by `site_id`.
- Subsequent chat requests retrieve top-k chunks for each question before generating.

Ingestion is idempotent — re-running doesn't duplicate chunks.

## Security

- **API key isolation** — LLM keys live on the server; the widget never sees them.
- **Site ID scoping** — every DB query filters by `site_id`; no cross-tenant leakage.
- **Rate limiting** — per IP and per site via Cloudflare Workers built-in KV.
- **Prompt injection defense** — user messages are wrapped in `<user_message>…</user_message>` tags in the system prompt; the model is instructed to treat tagged content as data, not instructions.
- **Content Security Policy friendly** — no `eval`, no inline styles outside Shadow DOM.

## Cost profile

For a typical SaaS site with ~500 questions/day:

| Item                           | Monthly cost (USD) |
| ------------------------------ | ------------------ |
| Cloudflare Workers (free tier) | $0                 |
| LLM inference (gpt-4o-mini)    | ~$15               |
| Postgres + pgvector            | ~$5 (Supabase free tier at low volume) |
| **Total**                      | **~$20/month per site** |

Well within a productized $1.5k–$5k setup-fee + small retainer.

## Deployment

**Widget bundle:** build and upload to any CDN (Cloudflare R2, S3+CloudFront, Vercel, Netlify).
**Backend:** `wrangler deploy` to Cloudflare Workers.
**Database:** Supabase or Neon both work out of the box.

See [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Roadmap

- [ ] Handoff-to-human mode (hooks to Slack / Crisp / Intercom)
- [ ] Conversation analytics dashboard
- [ ] Customer-managed system prompts via hosted admin UI
- [ ] Per-site custom fonts loaded via Shadow DOM
- [ ] Lead capture — optional email gate after N messages
- [ ] Multi-language auto-detect

## Contributing

Issues and PRs welcome. Widget bundle size is a hard commitment: any change that bumps it above 35kb minified + gzipped needs a strong justification in the PR.

## License

MIT — see [LICENSE](LICENSE).

## Contact

Freelance AI engineering — RAG, chat widgets, AI copilots, end-to-end.
**Email:** hello@brightnwokoro.dev
**Portfolio:** https://brightnwokoro.dev
**Book a call:** https://calendly.com/brightnwokoro/intro
