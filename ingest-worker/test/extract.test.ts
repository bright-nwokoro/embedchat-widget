import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractPage, MIN_WORDS_PER_PAGE } from "../src/extract";

const SAMPLE_HTML = `<!doctype html>
<html>
  <head><title>Sample Page Title</title></head>
  <body>
    <nav>Nav links should be stripped</nav>
    <header>Header chrome</header>
    <main>
      <h1>Welcome</h1>
      <p>This is the main content with many words to exceed the minimum word requirement.</p>
      <p>It has multiple paragraphs that we keep intact and check for accurate extraction.</p>
      <p>We need quite a few more words to be safely above the fifty-word floor in all cases here.</p>
      <p>Additional filler sentence ensures the total word count comfortably exceeds the minimum threshold for extraction success.</p>
      <script>alert("script stripped")</script>
    </main>
    <footer>Footer should be stripped</footer>
  </body>
</html>`;

describe("extractPage", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("extracts <main> text and strips nav/header/footer/script", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(SAMPLE_HTML, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const page = await extractPage("https://example.com/p1");
    expect(page).not.toBeNull();
    expect(page!.title).toBe("Sample Page Title");
    expect(page!.text).toContain("Welcome");
    expect(page!.text).toContain("main content");
    expect(page!.text).toContain("multiple paragraphs");
    expect(page!.text).not.toContain("Nav links");
    expect(page!.text).not.toContain("Header chrome");
    expect(page!.text).not.toContain("Footer");
    expect(page!.text).not.toContain("alert");
  });

  it("returns null for non-HTML responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })),
    );
    const page = await extractPage("https://example.com/api");
    expect(page).toBeNull();
  });

  it("returns null when page has fewer than MIN_WORDS_PER_PAGE words", async () => {
    const tiny = `<!doctype html><html><body><main>Too short.</main></body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(tiny, { status: 200, headers: { "content-type": "text/html" } })),
    );
    const page = await extractPage("https://example.com/tiny");
    expect(page).toBeNull();
    expect(MIN_WORDS_PER_PAGE).toBeGreaterThan(5);
  });

  it("returns null for non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 404 })),
    );
    const page = await extractPage("https://example.com/missing");
    expect(page).toBeNull();
  });
});
