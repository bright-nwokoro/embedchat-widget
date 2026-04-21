import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkMarkdown } from "../src/chunk/markdown";

function loadSample(): string {
  return readFileSync(resolve(__dirname, "fixtures/sample.md"), "utf-8");
}

describe("chunkMarkdown", () => {
  it("produces at least one chunk per ## section in the sample", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    const sectionA = chunks.find((c) => c.heading_path?.includes("Section A"));
    const sectionB = chunks.find((c) => c.heading_path?.includes("Section B"));
    const sectionC = chunks.find((c) => c.heading_path?.includes("Section C"));
    expect(sectionA).toBeTruthy();
    expect(sectionB).toBeTruthy();
    expect(sectionC).toBeTruthy();
  });

  it("builds heading_path as breadcrumb with H1 + H2", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    const sectionA = chunks.find((c) => c.heading_path?.includes("Section A"))!;
    expect(sectionA.heading_path).toBe("# Project Title > ## Section A");
  });

  it("includes H3 in heading_path for nested sections", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    const nested = chunks.find((c) => c.heading_path?.includes("Section B subsection"))!;
    expect(nested.heading_path).toBe(
      "# Project Title > ## Section B > ### Section B subsection",
    );
  });

  it("keeps code blocks atomic in a single chunk", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    const withCode = chunks.find((c) => c.content.includes("function example"));
    expect(withCode).toBeTruthy();
    expect(withCode!.content).toContain("```ts");
    expect(withCode!.content).toContain("```");
    expect(withCode!.content).toContain("return x * 2");
  });

  it("assigns chunk_index starting at 0 within the source", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    expect(chunks[0].chunk_index).toBe(0);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].chunk_index).toBe(chunks[i - 1].chunk_index + 1);
    }
  });

  it("assigns source_path from options", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "docs/x.md" });
    for (const c of chunks) expect(c.source_path).toBe("docs/x.md");
  });

  it("produces non-empty content per chunk", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    for (const c of chunks) expect(c.content.trim().length).toBeGreaterThan(0);
  });

  it("splits oversized sections by paragraph while keeping under hard cap", () => {
    const longPara = "This is a filler paragraph. ".repeat(200);
    const input = `# Doc\n\n## Big Section\n\n${longPara}\n\n${longPara}\n\n${longPara}`;
    const chunks = chunkMarkdown(input, { sourcePath: "big.md" });
    const bigChunks = chunks.filter((c) => c.heading_path?.includes("Big Section"));
    expect(bigChunks.length).toBeGreaterThan(1);
    for (const c of bigChunks) expect(c.token_count).toBeLessThanOrEqual(1200);
  });
});
