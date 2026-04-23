import type { ExtractedPage } from "./types";

export const MIN_WORDS_PER_PAGE = 50;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const EXCLUDED_TAGS = [
  "script",
  "style",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "svg",
  "noscript",
  "template",
];

export async function extractPage(url: string): Promise<ExtractedPage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,*/*;q=0.5",
        "user-agent": "EmbedChat/3a (+https://github.com/brightnwokoro/embedchat-widget)",
      },
    });
  } catch {
    clearTimeout(timer);
    return null;
  }
  clearTimeout(timer);
  if (!res.ok) return null;
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!ct.includes("html")) return null;

  let html = await res.text();
  if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES);

  let title: string | null = null;
  const textBuffer: string[] = [];
  let inExcluded = 0;
  let inTitle = false;

  const rewriter = new HTMLRewriter()
    .on("title", {
      element(_el) {
        inTitle = true;
      },
      text(chunk) {
        if (inTitle) {
          title = (title ?? "") + chunk.text;
          if (chunk.lastInTextNode) inTitle = false;
        }
      },
    })
    .on(EXCLUDED_TAGS.join(","), {
      element(el) {
        inExcluded++;
        el.onEndTag(() => {
          inExcluded--;
        });
      },
    })
    .on("*", {
      text(chunk) {
        if (inExcluded === 0 && !inTitle) {
          textBuffer.push(chunk.text);
        }
      },
    });

  await rewriter.transform(new Response(html)).text();

  const text = textBuffer.join("").replace(/\s+/g, " ").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORDS_PER_PAGE) return null;

  const finalTitle = title as string | null;
  return {
    url,
    title: finalTitle ? finalTitle.trim() : null,
    text,
  };
}
