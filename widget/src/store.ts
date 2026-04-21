import type { Message, UIState } from "./types";

export interface StoreState {
  messages: Message[];
  ui: UIState;
}

export interface Store {
  getState(): StoreState;
  subscribe(fn: () => void): () => void;
  appendUserMessage(content: string): void;
  startAssistantStream(): void;
  appendAssistantToken(token: string): void;
  finishAssistantStream(): void;
  failAssistantStream(message: string): void;
  togglePanel(): void;
  openPanel(): void;
}

export function createStore(): Store {
  let state: StoreState = {
    messages: [],
    ui: { open: false, streaming: false },
  };
  const subs = new Set<() => void>();
  const notify = () => subs.forEach((fn) => fn());

  function mutate(next: StoreState) {
    state = next;
    notify();
  }

  return {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    appendUserMessage(content) {
      mutate({
        ...state,
        messages: [...state.messages, { role: "user", content }],
      });
    },
    startAssistantStream() {
      mutate({
        messages: [
          ...state.messages,
          { role: "assistant", content: "", streaming: true },
        ],
        ui: { ...state.ui, streaming: true },
      });
    },
    appendAssistantToken(token) {
      const msgs = state.messages.slice();
      const last = msgs.at(-1);
      if (!last || last.role !== "assistant" || !last.streaming) return;
      msgs[msgs.length - 1] = { ...last, content: last.content + token };
      mutate({ ...state, messages: msgs });
    },
    finishAssistantStream() {
      const msgs = state.messages.slice();
      const last = msgs.at(-1);
      if (last && last.role === "assistant" && last.streaming) {
        const { streaming, ...rest } = last;
        void streaming;
        msgs[msgs.length - 1] = rest;
      }
      mutate({ messages: msgs, ui: { ...state.ui, streaming: false } });
    },
    failAssistantStream(message) {
      const msgs = state.messages.slice();
      const last = msgs.at(-1);
      if (last && last.role === "assistant" && last.streaming) {
        msgs[msgs.length - 1] = { role: "assistant", content: message };
      } else {
        msgs.push({ role: "assistant", content: message });
      }
      mutate({ messages: msgs, ui: { ...state.ui, streaming: false } });
    },
    togglePanel() {
      mutate({ ...state, ui: { ...state.ui, open: !state.ui.open } });
    },
    openPanel() {
      mutate({ ...state, ui: { ...state.ui, open: true } });
    },
  };
}
