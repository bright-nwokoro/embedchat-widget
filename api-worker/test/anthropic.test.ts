import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnthropicProvider } from "../src/llm/anthropic";

// Fixture inlined because readFileSync is unavailable in Miniflare Workers runtime.
// Reference copy at test/fixtures/anthropic-stream.txt.
const FIXTURE = `event: message_start
data: {"type":"message_start","message":{"id":"m1","type":"message","role":"assistant","content":[],"model":"claude-haiku-4-5-20251001","stop_reason":null,"usage":{"input_tokens":12,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}

event: message_stop
data: {"type":"message_stop"}

`;

describe("AnthropicProvider", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("streams text deltas and aggregates usage", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(FIXTURE, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const provider = createAnthropicProvider("claude-haiku-4-5-20251001");
    const chunks = [];
    for await (const c of provider.stream({
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 400,
      apiKey: "anthropic-test",
    })) {
      chunks.push(c);
    }

    expect(chunks.filter((c) => c.delta).map((c) => c.delta).join("")).toBe("Hello");
    const done = chunks.find((c) => c.done);
    expect(done?.usage).toEqual({ inputTokens: 12, outputTokens: 2 });
  });

  it("sends correct request shape (system prompt as top-level system field)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(FIXTURE, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createAnthropicProvider("claude-haiku-4-5-20251001");
    for await (const _c of provider.stream({
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 400,
      apiKey: "k",
    })) {
      /* drain */
    }

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as any)["x-api-key"]).toBe("k");
    expect((init.headers as any)["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(400);
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
