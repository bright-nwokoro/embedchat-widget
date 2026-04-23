import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { clearCache as clearSitesDbCache } from "../src/sites-db";

// Inlined because readFileSync is unavailable in Miniflare runtime.
// Reference copy at test/fixtures/openai-short.txt.
const OPENAI_SHORT = `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}

data: [DONE]

`;

/** Build a stub Supabase sites row for sites-db.getSite lookups. */
function siteRow(siteId: string, overrides: Record<string, unknown> = {}) {
  const isDemoPublic = siteId === "demo-public";
  return {
    site_id: siteId,
    name: "Test",
    knowledge_source: null,
    status: "ready",
    chunk_count: 10,
    last_indexed_at: null,
    allowed_origins: isDemoPublic ? ["*"] : ["https://example.com"],
    system_prompt: "demo system prompt",
    allow_system_prompt_override: false,
    allowed_models: ["gpt-4o-mini", "claude-haiku"],
    default_model: "gpt-4o-mini",
    max_message_chars: 2000,
    max_history_turns: 10,
    max_output_tokens: 400,
    error_message: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      const u = String(url);
      if (u.match(/\/rest\/v1\/sites\?select=\*/)) {
        return new Response(JSON.stringify([siteRow("demo-public")]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.startsWith("https://api.openai.com")) {
        return new Response(OPENAI_SHORT, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("unexpected", { status: 500 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /chat", () => {
  beforeEach(() => {
    clearSitesDbCache();
  });

  it("streams SSE tokens for demo-public", async () => {
    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        "cf-connecting-ip": "5.5.5.5",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.text();
    expect(body).toContain('"t":"token"');
    expect(body).toContain('"v":"Hi"');
    expect(body).toContain('"t":"done"');
  });

  it("returns 404 for unknown siteId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.match(/\/rest\/v1\/sites\?select=\*/)) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );
    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://a.com", "cf-connecting-ip": "5.5.5.6" },
      body: JSON.stringify({
        siteId: "no-such",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for message over 2000 chars on demo-public", async () => {
    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://a.com", "cf-connecting-ip": "5.5.5.7" },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "x".repeat(2001) }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid model", async () => {
    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://a.com", "cf-connecting-ip": "5.5.5.8" },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-5",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rate-limits a single IP after 20 requests", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await SELF.fetch("https://fake/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://rl.example",
          "cf-connecting-ip": "9.9.9.9",
        },
        body: JSON.stringify({
          siteId: "demo-public",
          messages: [{ role: "user", content: "hi" }],
          systemPrompt: null,
          model: "gpt-4o-mini",
        }),
      });
      await res.text();
      expect([200, 429]).toContain(res.status);
    }
    const blocked = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://rl.example",
        "cf-connecting-ip": "9.9.9.9",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(blocked.status).toBe(429);
  });

  it("OPTIONS preflight returns CORS headers", async () => {
    const res = await SELF.fetch("https://fake/chat", {
      method: "OPTIONS",
      headers: {
        origin: "https://somewhere.com",
        "access-control-request-method": "POST",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("POST /chat with RAG", () => {
  beforeEach(() => {
    clearSitesDbCache();
  });

  it("injects <context> into the system prompt when site.status=ready", async () => {
    const capturedOpenAIBody = { body: "" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.match(/\/rest\/v1\/sites\?select=\*/)) {
          return new Response(JSON.stringify([siteRow("demo-public")]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites")) {
          return new Response(
            JSON.stringify([
              { site_id: "demo-public", status: "ready", chunk_count: 2, last_indexed_at: null },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/rpc/match_chunks")) {
          return new Response(
            JSON.stringify([
              {
                id: "1",
                source_path: "README.md",
                heading_path: "## Rate limits",
                content: "Three KV-counter gates.",
                similarity: 0.92,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u === "https://api.openai.com/v1/embeddings") {
          return new Response(
            JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.1) }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u === "https://api.openai.com/v1/chat/completions") {
          capturedOpenAIBody.body = (init as any).body;
          return new Response(
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://rag.example",
        "cf-connecting-ip": "10.10.10.10",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "how does rate limiting work?" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const openaiBody = JSON.parse(capturedOpenAIBody.body);
    const systemMsg = openaiBody.messages.find((m: any) => m.role === "system");
    expect(systemMsg).toBeTruthy();
    expect(systemMsg.content).toContain("<context source=\"README.md\"");
    expect(systemMsg.content).toContain("Three KV-counter gates.");
  });

  it("falls back to ungrounded when Supabase is down", async () => {
    const capturedOpenAIBody = { body: "" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.match(/\/rest\/v1\/sites\?select=\*/)) {
          return new Response(JSON.stringify([siteRow("demo-public")]), { status: 200 });
        }
        if (u.startsWith(env.SUPABASE_URL)) {
          return new Response("upstream down", { status: 503 });
        }
        if (u === "https://api.openai.com/v1/chat/completions") {
          capturedOpenAIBody.body = (init as any).body;
          return new Response(
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://rag-down.example",
        "cf-connecting-ip": "10.10.10.11",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const openaiBody = JSON.parse(capturedOpenAIBody.body);
    const systemMsg = openaiBody.messages.find((m: any) => m.role === "system");
    expect(systemMsg.content).not.toContain("<context");
  });

  it("skips RAG when site.status is not 'ready'", async () => {
    const capturedOpenAIBody = { body: "" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.match(/\/rest\/v1\/sites\?select=\*/)) {
          return new Response(JSON.stringify([siteRow("demo-public")]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites")) {
          return new Response(
            JSON.stringify([
              { site_id: "demo-public", status: "pending", chunk_count: 0, last_indexed_at: null },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u === "https://api.openai.com/v1/chat/completions") {
          capturedOpenAIBody.body = (init as any).body;
          return new Response(
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://pending.example",
        "cf-connecting-ip": "10.10.10.12",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const openaiBody = JSON.parse(capturedOpenAIBody.body);
    const systemMsg = openaiBody.messages.find((m: any) => m.role === "system");
    expect(systemMsg.content).not.toContain("<context");
  });

  it("times out RAG if Supabase hangs and falls back to ungrounded", async () => {
    const capturedOpenAIBody = { body: "" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.match(/\/rest\/v1\/sites\?select=\*/)) {
          return new Response(JSON.stringify([siteRow("demo-public")]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.startsWith(env.SUPABASE_URL)) {
          // Never resolves — simulates a hung Supabase.
          return new Promise<Response>(() => {});
        }
        if (u === "https://api.openai.com/v1/chat/completions") {
          capturedOpenAIBody.body = (init as any).body;
          return new Response(
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const t0 = Date.now();
    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://timeout.example",
        "cf-connecting-ip": "10.10.10.13",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    await res.text();
    // Should fall back to ungrounded after the 5000ms RAG timeout, not hang indefinitely.
    expect(elapsed).toBeLessThan(8000);

    const openaiBody = JSON.parse(capturedOpenAIBody.body);
    const systemMsg = openaiBody.messages.find((m: any) => m.role === "system");
    expect(systemMsg.content).not.toContain("<context");
  }, 10000);
});

describe("GET /health", () => {
  it("returns ok with provider status", async () => {
    const res = await SELF.fetch("https://fake/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      providers: { openai: "configured", anthropic: "configured" },
    });
  });
});
