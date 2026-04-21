import { describe, it, expect } from "vitest";
import { countTokens } from "../src/tokenizer";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts a simple ASCII word as a small number of tokens", () => {
    const n = countTokens("hello");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(2);
  });

  it("counts longer text proportionally", () => {
    const short = countTokens("hello world");
    const long = countTokens("hello world ".repeat(20));
    expect(long).toBeGreaterThan(short * 10);
  });

  it("handles unicode without crashing", () => {
    expect(() => countTokens("café 日本語 😀")).not.toThrow();
    expect(countTokens("café 日本語 😀")).toBeGreaterThan(0);
  });
});
