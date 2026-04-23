import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";

describe("admin auth middleware", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await SELF.fetch("https://fake/admin/ping");
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer token is wrong", async () => {
    const res = await SELF.fetch("https://fake/admin/ping", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts a correct bearer token", async () => {
    const res = await SELF.fetch("https://fake/admin/ping", {
      headers: { authorization: `Bearer ${env.ADMIN_API_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("rejects empty bearer token", async () => {
    const res = await SELF.fetch("https://fake/admin/ping", {
      headers: { authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });
});
