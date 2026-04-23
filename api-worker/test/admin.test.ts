import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";
import { clearCache as clearSitesDbCache } from "../src/sites-db";

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

describe("POST /admin/sites", () => {
  beforeEach(() => {
    clearSitesDbCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  const authHeader = () => ({ authorization: `Bearer ${env.ADMIN_API_KEY}` });

  const validBody = () => ({
    siteId: "acme-docs",
    name: "Acme Docs",
    knowledgeUrl: "https://docs.acme.com/sitemap.xml",
    systemPrompt: "You are Acme's docs assistant.",
    allowedOrigins: ["https://docs.acme.com"],
  });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://fake/admin/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(401);
  });

  it("rejects malformed siteId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        if ((init as any)?.method === "HEAD") {
          return new Response(null, { status: 200, headers: { "content-type": "application/xml" } });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );
    const res = await SELF.fetch("https://fake/admin/sites", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify({ ...validBody(), siteId: "UPPERCASE" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("invalid-siteId");
  });

  it("rejects when knowledge-url pre-flight fails (404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: any, init?: any) => {
        if ((init as any)?.method === "HEAD") {
          return new Response(null, { status: 404 });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );
    const res = await SELF.fetch("https://fake/admin/sites", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("knowledge-url-unreachable");
  });

  it("rejects when knowledge-url is not XML", async () => {
    const body = { ...validBody(), knowledgeUrl: "https://docs.acme.com/index.html" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: any, init?: any) => {
        if ((init as any)?.method === "HEAD") {
          return new Response(null, { status: 200, headers: { "content-type": "text/html" } });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );
    const res = await SELF.fetch("https://fake/admin/sites", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.error).toBe("knowledge-url-not-xml");
  });

  it("happy path: returns 202, inserts site row, enqueues ingest job", async () => {
    let insertedBody: any = null;
    let queueSends = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        const method = (init as any)?.method;
        if (method === "HEAD") {
          return new Response(null, { status: 200, headers: { "content-type": "application/xml" } });
        }
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites") && method === "GET") {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites") && method === "POST") {
          insertedBody = JSON.parse((init as any).body);
          return new Response(JSON.stringify([{}]), { status: 201 });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const originalSend = env.INGEST_QUEUE.send.bind(env.INGEST_QUEUE);
    (env.INGEST_QUEUE as any).send = vi.fn(async (msg: any) => {
      queueSends++;
      return originalSend(msg);
    });

    const res = await SELF.fetch("https://fake/admin/sites", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify(validBody()),
    });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toMatchObject({ siteId: "acme-docs", status: "pending" });
    expect(insertedBody.site_id).toBe("acme-docs");
    expect(insertedBody.status).toBe("pending");
    expect(insertedBody.allowed_origins).toEqual(["https://docs.acme.com"]);
    expect(insertedBody.system_prompt).toBe("You are Acme's docs assistant.");
    expect(queueSends).toBe(1);

    (env.INGEST_QUEUE as any).send = originalSend;
  });

  it("returns 409 when siteId already exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        const method = (init as any)?.method;
        if (method === "HEAD") {
          return new Response(null, { status: 200, headers: { "content-type": "application/xml" } });
        }
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites") && method === "GET") {
          return new Response(JSON.stringify([{ site_id: "acme-docs" }]), { status: 200 });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await SELF.fetch("https://fake/admin/sites", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader() },
      body: JSON.stringify(validBody()),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.error).toBe("site-exists");
  });
});
