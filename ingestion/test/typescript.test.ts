import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkTypeScript } from "../src/chunk/typescript";

function loadSample(): string {
  return readFileSync(resolve(__dirname, "fixtures/sample.ts"), "utf-8");
}

describe("chunkTypeScript", () => {
  it("produces one chunk per top-level exported symbol", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    const names = chunks
      .map((c) => c.heading_path)
      .filter((h): h is string => h !== null);
    expect(names.some((h) => h.endsWith("export: double"))).toBe(true);
    expect(names.some((h) => h.endsWith("export: MAX_RETRIES"))).toBe(true);
    expect(names.some((h) => h.endsWith("export: SampleConfig"))).toBe(true);
    expect(names.some((h) => h.endsWith("export: SampleClass"))).toBe(true);
  });

  it("attaches preceding JSDoc comments to the chunk", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    const doubleChunk = chunks.find((c) => c.heading_path?.endsWith("double"))!;
    expect(doubleChunk.content).toContain("Doubles the input value");
  });

  it("attaches preceding line comments to the chunk", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    const maxChunk = chunks.find((c) => c.heading_path?.endsWith("MAX_RETRIES"))!;
    expect(maxChunk.content).toContain("Simple comment on this one");
  });

  it("prepends an import prelude to each chunk", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    for (const c of chunks) {
      expect(c.content.split("\n")[0]).toMatch(/^\/\/ from sample\.ts/);
    }
  });

  it("heading_path uses `{path} > export: {name}` format", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "widget/foo.ts" });
    for (const c of chunks) {
      expect(c.heading_path).toMatch(/^widget\/foo\.ts > export: /);
    }
  });

  it("assigns sequential chunk_index starting at 0", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    chunks.forEach((c, i) => expect(c.chunk_index).toBe(i));
  });

  it("includes the declaration body text", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    const classChunk = chunks.find((c) => c.heading_path?.endsWith("SampleClass"))!;
    expect(classChunk.content).toContain("describe(): string");
    expect(classChunk.content).toContain("return `Sample(");
  });

  it("returns empty array for a file with no exports", () => {
    const input = `const private_ = 1;\nfunction helper() {}\n`;
    const chunks = chunkTypeScript(input, { sourcePath: "x.ts" });
    expect(chunks).toEqual([]);
  });
});
