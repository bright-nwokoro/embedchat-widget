import { describe, it, expect } from "vitest";
import { createStore } from "../src/store";

describe("createStore", () => {
  it("starts with empty messages and closed ui", () => {
    const store = createStore();
    const s = store.getState();
    expect(s.messages).toEqual([]);
    expect(s.ui.open).toBe(false);
    expect(s.ui.streaming).toBe(false);
  });

  it("appendUserMessage adds a user message", () => {
    const store = createStore();
    store.appendUserMessage("hello");
    const s = store.getState();
    expect(s.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("startAssistantStream appends empty streaming assistant and flips streaming=true", () => {
    const store = createStore();
    store.appendUserMessage("hi");
    store.startAssistantStream();
    const s = store.getState();
    expect(s.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "", streaming: true },
    ]);
    expect(s.ui.streaming).toBe(true);
  });

  it("appendAssistantToken appends to last assistant message", () => {
    const store = createStore();
    store.appendUserMessage("hi");
    store.startAssistantStream();
    store.appendAssistantToken("He");
    store.appendAssistantToken("llo");
    const last = store.getState().messages.at(-1);
    expect(last?.content).toBe("Hello");
    expect(last?.streaming).toBe(true);
  });

  it("finishAssistantStream clears streaming flags", () => {
    const store = createStore();
    store.appendUserMessage("hi");
    store.startAssistantStream();
    store.appendAssistantToken("Hi!");
    store.finishAssistantStream();
    const s = store.getState();
    expect(s.messages.at(-1)?.streaming).toBeUndefined();
    expect(s.ui.streaming).toBe(false);
  });

  it("failAssistantStream replaces last assistant with error content", () => {
    const store = createStore();
    store.appendUserMessage("hi");
    store.startAssistantStream();
    store.failAssistantStream("Network error");
    const s = store.getState();
    expect(s.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Network error",
    });
    expect(s.ui.streaming).toBe(false);
  });

  it("togglePanel flips open", () => {
    const store = createStore();
    store.togglePanel();
    expect(store.getState().ui.open).toBe(true);
    store.togglePanel();
    expect(store.getState().ui.open).toBe(false);
  });

  it("subscribe notifies on every change", () => {
    const store = createStore();
    let calls = 0;
    const unsub = store.subscribe(() => calls++);
    store.togglePanel();
    store.appendUserMessage("x");
    expect(calls).toBe(2);
    unsub();
    store.togglePanel();
    expect(calls).toBe(2);
  });
});
