import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOpenAIProvider } from "../src/llm/openai";

// Fixture content mirrors api-worker/test/fixtures/openai-stream.txt exactly.
// readFileSync is not available in the Cloudflare Workers miniflare runtime, so
// the fixture is inlined here as a string constant.
const FIXTURE = [
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
  "",
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}',
  "",
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}',
  "",
  'data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
  "",
  "data: [DONE]",
  "",
].join("\n");

function loadFixture(): string {
  return FIXTURE;
}

describe("OpenAIProvider", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("streams deltas and final usage", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(loadFixture(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const provider = createOpenAIProvider("gpt-4o-mini");
    const chunks = [];
    for await (const c of provider.stream({
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 400,
      apiKey: "sk-test",
    })) {
      chunks.push(c);
    }

    const tokens = chunks.filter((c) => c.delta).map((c) => c.delta);
    expect(tokens.join("")).toBe("Hello");
    const done = chunks.find((c) => c.done);
    expect(done?.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  });

  it("sends correct request shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(loadFixture(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAIProvider("gpt-4o-mini");
    for await (const _c of provider.stream({
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 400,
      apiKey: "sk-test",
    })) {
      /* drain */
    }

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as any)["authorization"]).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.max_completion_tokens ?? body.max_tokens).toBe(400);
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });
});
