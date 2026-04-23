import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { getSite, clearCache, CACHE_TTL_MS } from "../src/sites-db";

describe("getSite", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stubSupabaseRow(siteId: string, overrides: Record<string, unknown> = {}) {
    return new Response(
      JSON.stringify([
        {
          site_id: siteId,
          name: "Test Site",
          knowledge_source: "test",
          status: "ready",
          chunk_count: 10,
          last_indexed_at: null,
          allowed_origins: ["https://example.com"],
          system_prompt: "test prompt",
          allow_system_prompt_override: false,
          allowed_models: ["gpt-4o-mini", "claude-haiku"],
          default_model: "gpt-4o-mini",
          max_message_chars: 2000,
          max_history_turns: 10,
          max_output_tokens: 400,
          error_message: null,
          ...overrides,
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  it("fetches from Supabase on cache miss and returns a SiteConfig", async () => {
    const fetchMock = vi.fn(async () => stubSupabaseRow("acme"));
    vi.stubGlobal("fetch", fetchMock);

    const site = await getSite(env, "acme");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(String(url)).toContain("/rest/v1/sites?select=*&site_id=eq.acme");
    expect(site).not.toBeNull();
    expect(site!.id).toBe("acme");
    expect(site!.systemPrompt).toBe("test prompt");
    expect(site!.allowedOrigins).toEqual(["https://example.com"]);
  });

  it("translates ['*'] allowed_origins to '*' sentinel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => stubSupabaseRow("demo-public", { allowed_origins: ["*"] })),
    );
    const site = await getSite(env, "demo-public");
    expect(site!.allowedOrigins).toBe("*");
  });

  it("returns null when site does not exist (empty array response)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    const site = await getSite(env, "missing");
    expect(site).toBeNull();
  });

  it("returns null on Supabase error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const site = await getSite(env, "acme");
    expect(site).toBeNull();
  });

  it("caches results within the TTL window", async () => {
    const fetchMock = vi.fn(async () => stubSupabaseRow("acme"));
    vi.stubGlobal("fetch", fetchMock);

    await getSite(env, "acme");
    await getSite(env, "acme");
    await getSite(env, "acme");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after TTL expires", async () => {
    const fetchMock = vi.fn(async () => stubSupabaseRow("acme"));
    vi.stubGlobal("fetch", fetchMock);

    await getSite(env, "acme");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(CACHE_TTL_MS + 1);
    await getSite(env, "acme");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches null results too (negative caching)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await getSite(env, "missing");
    await getSite(env, "missing");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
