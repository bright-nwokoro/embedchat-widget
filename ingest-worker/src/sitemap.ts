export const MAX_SITEMAP_URLS = 200;

export async function fetchSitemapUrls(knowledgeUrl: string): Promise<string[]> {
  const res = await fetch(knowledgeUrl, {
    headers: { accept: "application/xml,text/xml,*/*;q=0.5" },
  });
  if (!res.ok) {
    throw new Error(`sitemap fetch failed: ${res.status}`);
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const isXml = ct.includes("xml") || knowledgeUrl.toLowerCase().endsWith(".xml");
  if (!isXml) {
    throw new Error(`sitemap not-xml: ${ct}`);
  }
  const text = await res.text();

  // Simple <loc>...</loc> extraction via matchAll. Robust enough for standard sitemaps.
  const urls: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  for (const match of text.matchAll(re)) {
    const url = match[1]!.trim();
    if (url.length > 0) urls.push(url);
    if (urls.length >= MAX_SITEMAP_URLS) break;
  }
  return urls;
}
