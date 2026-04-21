import { describe, it, expect, vi } from "vitest";
import { parseConfig } from "../src/config";

function makeScript(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  return s;
}

describe("parseConfig", () => {
  it("requires data-site-id", () => {
    const s = makeScript({ "data-api-url": "https://api.example.com" });
    expect(() => parseConfig(s)).toThrow(/data-site-id/);
  });

  it("applies defaults when attrs are missing", () => {
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://api.example.com",
    });
    const c = parseConfig(s);
    expect(c.siteId).toBe("demo-public");
    expect(c.primaryColor).toBe("#7C5CFF");
    expect(c.greeting).toBe("Hi, how can I help?");
    expect(c.position).toBe("bottom-right");
    expect(c.model).toBe("gpt-4o-mini");
    expect(c.maxMessages).toBe(30);
    expect(c.systemPrompt).toBeNull();
    expect(c.avatarUrl).toBeNull();
    expect(c.knowledgeUrl).toBeNull();
  });

  it("reads data-primary-color, data-greeting, data-system-prompt", () => {
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://api.example.com",
      "data-primary-color": "#ff0000",
      "data-greeting": "Hello!",
      "data-system-prompt": "Be terse.",
    });
    const c = parseConfig(s);
    expect(c.primaryColor).toBe("#ff0000");
    expect(c.greeting).toBe("Hello!");
    expect(c.systemPrompt).toBe("Be terse.");
  });

  it("validates primary color format", () => {
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://api.example.com",
      "data-primary-color": "not a color",
    });
    expect(() => parseConfig(s)).toThrow(/primary-color/);
  });

  it("validates position enum", () => {
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://api.example.com",
      "data-position": "top-left",
    });
    expect(() => parseConfig(s)).toThrow(/position/);
  });

  it("validates model enum", () => {
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://api.example.com",
      "data-model": "gpt-5",
    });
    expect(() => parseConfig(s)).toThrow(/model/);
  });

  it("parses max-messages as integer", () => {
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://api.example.com",
      "data-max-messages": "15",
    });
    expect(parseConfig(s).maxMessages).toBe(15);
  });

  it("rejects non-integer max-messages", () => {
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://api.example.com",
      "data-max-messages": "abc",
    });
    expect(() => parseConfig(s)).toThrow(/max-messages/);
  });

  it("ignores data-knowledge-url with console notice (Phase 1)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://api.example.com",
      "data-knowledge-url": "https://example.com/sitemap.xml",
    });
    const c = parseConfig(s);
    expect(c.knowledgeUrl).toBe("https://example.com/sitemap.xml");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("knowledge"));
    info.mockRestore();
  });

  it("derives apiUrl from data-api-url", () => {
    const s = makeScript({
      "data-site-id": "demo-public",
      "data-api-url": "https://my-api.example.com",
    });
    expect(parseConfig(s).apiUrl).toBe("https://my-api.example.com");
  });

  it("requires data-api-url", () => {
    const s = makeScript({ "data-site-id": "demo-public" });
    expect(() => parseConfig(s)).toThrow(/data-api-url/);
  });
});
