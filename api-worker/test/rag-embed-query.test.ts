import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embedQuery } from "../src/rag/embed-query";

describe("embedQuery", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("calls the OpenAI embeddings endpoint with the query", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.25) }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", mock);

    const vec = await embedQuery("hello world", "sk-test");
    expect(vec).toHaveLength(1536);
    expect(vec[0]).toBe(0.25);

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect((init.headers as any).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toBe("hello world");
  });

  it("truncates very long inputs to a safe length", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.1) }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", mock);

    const longInput = "x".repeat(20000);
    await embedQuery(longInput, "sk-test");
    const body = JSON.parse((mock.mock.calls[0] as any)[1].body);
    expect(body.input.length).toBeLessThanOrEqual(8000);
  });

  it("throws on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    await expect(embedQuery("hi", "sk-test")).rejects.toThrow(/OpenAI/);
  });

  it("rejects empty query", async () => {
    await expect(embedQuery("", "sk-test")).rejects.toThrow(/empty/);
  });
});
