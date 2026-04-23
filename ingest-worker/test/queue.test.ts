import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/index";

const SAMPLE_SITEMAP = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/page-1</loc></url>
  <url><loc>https://example.com/page-2</loc></url>
</urlset>`;

const SAMPLE_PAGE = (title: string) => `<!doctype html>
<html>
  <head><title>${title}</title></head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>This page is the main content. It has lots and lots of words.
      Words words words words words words words words words words words words
      words words words words words words words words words words words words
      words words words words words words words words words words words words words.</p>
    </main>
  </body>
</html>`;

describe("ingest-worker queue handler", () => {
  let supabaseCalls: Array<{ method: string; url: string; body: unknown }>;
  let acks: number;
  let retries: number;

  beforeEach(() => {
    supabaseCalls = [];
    acks = 0;
    retries = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        const method = (init as any)?.method ?? "GET";

        if (u === "https://example.com/sitemap.xml") {
          return new Response(SAMPLE_SITEMAP, {
            status: 200,
            headers: { "content-type": "application/xml" },
          });
        }
        if (u === "https://example.com/page-1") {
          return new Response(SAMPLE_PAGE("Page One"), {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        if (u === "https://example.com/page-2") {
          return new Response(SAMPLE_PAGE("Page Two"), {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        if (u === "https://api.openai.com/v1/embeddings") {
          const body = JSON.parse((init as any).body);
          return new Response(
            JSON.stringify({
              data: body.input.map(() => ({ embedding: new Array(1536).fill(0.1) })),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u.startsWith(env.SUPABASE_URL)) {
          const body = init?.body ? JSON.parse(init.body as string) : null;
          supabaseCalls.push({ method, url: u, body });
          return new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("unexpected: " + u, { status: 500 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("processes a job: fetch sitemap, crawl pages, chunk, embed, store, ack", async () => {
    const batch: MessageBatch<any> = {
      queue: "embedchat-ingest",
      messages: [
        {
          id: "m1",
          timestamp: new Date(),
          body: { siteId: "test-site", knowledgeUrl: "https://example.com/sitemap.xml" },
          attempts: 1,
          ack: () => { acks++; },
          retry: () => { retries++; },
        } as any,
      ],
      ackAll: () => {},
      retryAll: () => {},
    } as any;

    await worker.queue(batch, env, {} as ExecutionContext);

    expect(acks).toBe(1);
    expect(retries).toBe(0);

    // Expect at minimum: indexing marker, chunks delete, chunks insert, ready marker.
    const lastSitesUpdate = supabaseCalls
      .slice()
      .reverse()
      .find((c) => (c.method === "PATCH" || c.method === "POST") && c.url.includes("/rest/v1/sites"));
    expect(lastSitesUpdate).toBeTruthy();
  });

  it("on processing failure, marks site 'failed' and retries the job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        const method = (init as any)?.method ?? "GET";
        if (u === "https://example.com/sitemap.xml") {
          return new Response("err", { status: 500 });
        }
        if (u.startsWith(env.SUPABASE_URL)) {
          supabaseCalls.push({
            method,
            url: u,
            body: init?.body ? JSON.parse(init.body as string) : null,
          });
          return new Response("[]", { status: 200 });
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const batch: MessageBatch<any> = {
      queue: "embedchat-ingest",
      messages: [
        {
          id: "m2",
          timestamp: new Date(),
          body: { siteId: "fail-site", knowledgeUrl: "https://example.com/sitemap.xml" },
          attempts: 1,
          ack: () => { acks++; },
          retry: () => { retries++; },
        } as any,
      ],
      ackAll: () => {},
      retryAll: () => {},
    } as any;

    await worker.queue(batch, env, {} as ExecutionContext);

    expect(acks).toBe(0);
    expect(retries).toBe(1);
    const failed = supabaseCalls.find(
      (c) => c.method === "PATCH" && JSON.stringify(c.body).includes("failed"),
    );
    expect(failed).toBeTruthy();
  });
});
