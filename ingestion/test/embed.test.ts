import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embedBatch } from "../src/embed/openai";

describe("embedBatch", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to the OpenAI embeddings endpoint with correct headers + body", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
          usage: { total_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", mock);

    const out = await embedBatch(["hello", "world"], "sk-test");
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toEqual(["hello", "world"]);
    expect(out).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("retries once on 429, then succeeds", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ embedding: [1, 2] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", mock);

    const out = await embedBatch(["x"], "sk-test");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(out).toEqual([[1, 2]]);
  });

  it("throws after a second failure", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response("bad", { status: 500 }),
    );
    vi.stubGlobal("fetch", mock);

    await expect(embedBatch(["x"], "sk-test")).rejects.toThrow(/OpenAI/);
  });

  it("rejects empty input", async () => {
    await expect(embedBatch([], "sk-test")).rejects.toThrow(/empty/);
  });
});
