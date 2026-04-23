import { describe, it, expect } from "vitest";
import { chunkPlainText, TARGET_TOKENS, OVERLAP_TOKENS } from "../src/plaintext-chunker";

function longText(paragraphs: number, wordsPerPara: number = 80): string {
  const para = Array.from({ length: wordsPerPara }, (_, i) => `word${i}`).join(" ");
  return Array.from({ length: paragraphs }, () => para).join("\n\n");
}

describe("chunkPlainText", () => {
  it("returns a single chunk when total tokens <= target", () => {
    const chunks = chunkPlainText("Short content under target.", {
      siteId: "acme",
      sourcePath: "https://docs.acme.com/p",
      headingPath: "Page One",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toContain("Short content");
    expect(chunks[0]!.heading_path).toBe("Page One");
    expect(chunks[0]!.source_path).toBe("https://docs.acme.com/p");
    expect(chunks[0]!.site_id).toBe("acme");
  });

  it("produces multiple chunks for text exceeding target", () => {
    const text = longText(10, 80);
    const chunks = chunkPlainText(text, {
      siteId: "acme",
      sourcePath: "https://docs.acme.com/big",
      headingPath: "Big Page",
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.token_count).toBeLessThanOrEqual(TARGET_TOKENS + OVERLAP_TOKENS + 50);
    }
  });

  it("assigns sequential chunk_index starting at 0", () => {
    const chunks = chunkPlainText(longText(10, 80), {
      siteId: "acme",
      sourcePath: "u",
      headingPath: "h",
    });
    chunks.forEach((c, i) => expect(c.chunk_index).toBe(i));
  });

  it("drops chunks with fewer than 20 tokens (fragmentary)", () => {
    const chunks = chunkPlainText("tiny", {
      siteId: "acme",
      sourcePath: "u",
      headingPath: "h",
    });
    expect(chunks).toHaveLength(0);
  });

  it("applies overlap of OVERLAP_TOKENS between adjacent chunks", () => {
    const text = longText(6, 80);
    const chunks = chunkPlainText(text, {
      siteId: "acme",
      sourcePath: "u",
      headingPath: "h",
    });
    if (chunks.length >= 2) {
      const firstLastWords = chunks[0]!.content.split(/\s+/).slice(-OVERLAP_TOKENS);
      const lastFragment = firstLastWords.slice(-5).join(" ");
      expect(chunks[1]!.content).toContain(lastFragment);
    }
  });
});
