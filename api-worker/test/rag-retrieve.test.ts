import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSiteRagState, retrieveChunks } from "../src/rag/retrieve";

function stubSupabase(responseBody: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("getSiteRagState", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns site state when the row exists", async () => {
    vi.stubGlobal(
      "fetch",
      stubSupabase([
        {
          site_id: "demo-public",
          status: "ready",
          chunk_count: 42,
          last_indexed_at: "2026-04-21T00:00:00Z",
        },
      ]),
    );

    const state = await getSiteRagState(
      "https://test.supabase.co",
      "test-anon",
      "demo-public",
    );
    expect(state).not.toBeNull();
    expect(state!.status).toBe("ready");
    expect(state!.chunk_count).toBe(42);
  });

  it("returns null when the row does not exist", async () => {
    vi.stubGlobal("fetch", stubSupabase([]));
    const state = await getSiteRagState(
      "https://test.supabase.co",
      "test-anon",
      "does-not-exist",
    );
    expect(state).toBeNull();
  });

  it("returns null on Supabase error (best-effort semantics)", async () => {
    vi.stubGlobal("fetch", stubSupabase({ error: "boom" }, 500));
    const state = await getSiteRagState(
      "https://test.supabase.co",
      "test-anon",
      "demo-public",
    );
    expect(state).toBeNull();
  });
});

describe("retrieveChunks", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the match_chunks RPC with correct payload", async () => {
    const mock = stubSupabase([
      { id: "1", source_path: "README.md", heading_path: "## Sec", content: "body", similarity: 0.9 },
    ]);
    vi.stubGlobal("fetch", mock);

    const embedding = new Array(1536).fill(0.5);
    const chunks = await retrieveChunks(
      "https://test.supabase.co",
      "test-anon",
      "demo-public",
      embedding,
      5,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.similarity).toBe(0.9);

    const [url, init] = (mock.mock.calls[0] as any);
    expect(String(url)).toContain("/rest/v1/rpc/match_chunks");
    expect((init as any).method).toBe("POST");
    const body = JSON.parse((init as any).body);
    expect(body.match_site_id).toBe("demo-public");
    expect(body.match_count).toBe(5);
    expect(body.query_embedding).toEqual(embedding);
  });

  it("returns [] on Supabase error (best-effort)", async () => {
    vi.stubGlobal("fetch", stubSupabase({ error: "boom" }, 500));
    const embedding = new Array(1536).fill(0.5);
    const chunks = await retrieveChunks(
      "https://test.supabase.co",
      "test-anon",
      "demo-public",
      embedding,
      5,
    );
    expect(chunks).toEqual([]);
  });
});
