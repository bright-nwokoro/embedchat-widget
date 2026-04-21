import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SELF } from "cloudflare:test";

// Inlined because readFileSync is unavailable in Miniflare runtime.
// Reference copy at test/fixtures/openai-short.txt.
const OPENAI_SHORT = `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}

data: [DONE]

`;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      if (String(url).startsWith("https://api.openai.com")) {
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
