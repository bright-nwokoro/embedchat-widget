import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { clearCache as clearSitesDbCache } from "../src/sites-db";

const OPENAI_SHORT = `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}

data: [DONE]

`;

beforeEach(() => {
  clearSitesDbCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      const u = String(url);
      if (u.match(/\/rest\/v1\/sites\?select=\*/)) {
        return new Response(
          JSON.stringify([{
            site_id: "demo-public",
            name: "Demo",
            knowledge_source: null,
            status: "ready",
            chunk_count: 1,
            last_indexed_at: null,
            allowed_origins: ["*"],
            system_prompt: "demo system prompt",
            allow_system_prompt_override: false,
            allowed_models: ["gpt-4o-mini", "claude-haiku"],
            default_model: "gpt-4o-mini",
            max_message_chars: 2000,
            max_history_turns: 10,
            max_output_tokens: 400,
            error_message: null,
          }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites")) {
        return new Response(
          JSON.stringify([
            { site_id: "demo-public", status: "ready", chunk_count: 1, last_indexed_at: null },
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
              heading_path: "## E2E",
              content: "known-e2e-chunk",
              similarity: 0.9,
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

describe("e2e: /chat smoke — grounded", () => {
  it("streams tokens and injects retrieved context", async () => {
    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://e2e.example",
        "cf-connecting-ip": "7.7.7.7",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "tell me about e2e" }],
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
