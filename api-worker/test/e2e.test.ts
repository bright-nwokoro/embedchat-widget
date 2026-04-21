import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SELF } from "cloudflare:test";

// Inlined because readFileSync is unavailable in Miniflare runtime.
// Content mirrors test/fixtures/openai-short.txt.
const OPENAI_SHORT = `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}

data: [DONE]

`;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(OPENAI_SHORT, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("e2e: /chat smoke", () => {
  it("streams at least one token + a done frame for demo-public", async () => {
    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://e2e.example",
        "cf-connecting-ip": "7.7.7.7",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hello" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const frames = text.split("\n\n").filter(Boolean);
    const parsed = frames.map((f) => JSON.parse(f.replace(/^data:\s*/, "")));
    expect(parsed.some((p) => p.t === "token")).toBe(true);
    expect(parsed.some((p) => p.t === "done")).toBe(true);
  });
});
