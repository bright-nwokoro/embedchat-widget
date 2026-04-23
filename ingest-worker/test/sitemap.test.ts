import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSitemapUrls, MAX_SITEMAP_URLS } from "../src/sitemap";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page-1</loc></url>
  <url><loc>https://example.com/page-2</loc></url>
  <url><loc>https://example.com/page-3</loc></url>
</urlset>`;

describe("fetchSitemapUrls", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("parses a valid sitemap into a URL list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(SAMPLE_XML, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      ),
    );
    const urls = await fetchSitemapUrls("https://example.com/sitemap.xml");
    expect(urls).toEqual([
      "https://example.com/page-1",
      "https://example.com/page-2",
      "https://example.com/page-3",
    ]);
  });

  it("throws when fetch is not 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 410 })));
    await expect(fetchSitemapUrls("https://x/sitemap.xml")).rejects.toThrow(/410/);
  });

  it("throws when content is not XML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html>not xml</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    await expect(fetchSitemapUrls("https://x/sitemap.html")).rejects.toThrow(/not-xml/);
  });

  it("caps URLs at MAX_SITEMAP_URLS", async () => {
    const hugeUrls = Array.from(
      { length: MAX_SITEMAP_URLS + 50 },
      (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`,
    ).join("");
    const hugeXml = `<?xml version="1.0"?><urlset>${hugeUrls}</urlset>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(hugeXml, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      ),
    );
    const urls = await fetchSitemapUrls("https://x/sitemap.xml");
    expect(urls).toHaveLength(MAX_SITEMAP_URLS);
  });

  it("ignores empty <loc> entries", async () => {
    const weird = `<?xml version="1.0"?><urlset><url><loc></loc></url><url><loc>https://good.example/</loc></url></urlset>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(weird, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      ),
    );
    const urls = await fetchSitemapUrls("https://x/sitemap.xml");
    expect(urls).toEqual(["https://good.example/"]);
  });
});
