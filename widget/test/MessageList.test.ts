import { describe, it, expect } from "vitest";
import { createMessageList } from "../src/ui/MessageList";
import { createStore } from "../src/store";
import type { Config } from "../src/types";

const config: Config = {
  siteId: "demo-public",
  apiUrl: "https://api.example.com",
  primaryColor: "#7C5CFF",
  greeting: "Hi!",
  systemPrompt: null,
  position: "bottom-right",
  model: "gpt-4o-mini",
  maxMessages: 30,
  avatarUrl: null,
  knowledgeUrl: null,
};

describe("MessageList", () => {
  it("renders greeting initially", () => {
    const store = createStore();
    const el = createMessageList(config, store);
    expect(el.textContent).toContain("Hi!");
  });

  it("renders user + assistant messages in order", () => {
    const store = createStore();
    const el = createMessageList(config, store);
    store.appendUserMessage("hello");
    store.startAssistantStream();
    store.appendAssistantToken("world");
    const bubbles = el.querySelectorAll(".ec-msg-bubble");
    expect(bubbles.length).toBeGreaterThanOrEqual(3);
    expect(bubbles[bubbles.length - 2]?.textContent).toBe("hello");
    expect(bubbles[bubbles.length - 1]?.textContent).toBe("world");
  });

  it("uses textContent (not innerHTML) for message bodies", () => {
    const store = createStore();
    const el = createMessageList(config, store);
    store.appendUserMessage("<script>alert(1)</script>");
    const bubbles = el.querySelectorAll(".ec-msg-bubble");
    const last = bubbles[bubbles.length - 1] as HTMLElement;
    expect(last.querySelector("script")).toBeNull();
    expect(last.textContent).toBe("<script>alert(1)</script>");
  });

  it("updates as tokens stream in", () => {
    const store = createStore();
    const el = createMessageList(config, store);
    store.appendUserMessage("q");
    store.startAssistantStream();
    store.appendAssistantToken("A");
    let last = el.querySelectorAll(".ec-msg-bubble");
    expect(last[last.length - 1]?.textContent).toBe("A");
    store.appendAssistantToken("BC");
    last = el.querySelectorAll(".ec-msg-bubble");
    expect(last[last.length - 1]?.textContent).toBe("ABC");
  });
});
