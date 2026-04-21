import type { Config } from "./types";
import { createStore } from "./store";
import { buildStyles } from "./styles";
import { createBubble } from "./ui/Bubble";
import { createPanel } from "./ui/Panel";
import { streamChat } from "./transport";

export function mount(config: Config): void {
  const container = document.createElement("div");
  container.setAttribute("data-embedchat", "root");
  document.body.appendChild(container);

  const shadow = container.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = buildStyles(config);
  shadow.appendChild(style);

  const store = createStore();
  const panel = createPanel(config, store);
  const bubble = createBubble(store);
  shadow.appendChild(panel);
  shadow.appendChild(bubble);

  panel.addEventListener("ec:send", (event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (typeof detail === "string") void send(detail);
  });

  async function send(text: string) {
    store.appendUserMessage(text);
    store.startAssistantStream();
    try {
      const stream = streamChat({
        apiUrl: config.apiUrl,
        body: {
          siteId: config.siteId,
          messages: store
            .getState()
            .messages.filter((m) => !m.streaming)
            .slice(-config.maxMessages),
          systemPrompt: config.systemPrompt,
          model: config.model,
        },
      });
      for await (const ev of stream) {
        if (ev.type === "token") store.appendAssistantToken(ev.value);
        else if (ev.type === "done") store.finishAssistantStream();
        else if (ev.type === "error") store.failAssistantStream(ev.message);
      }
      if (store.getState().ui.streaming) store.finishAssistantStream();
    } catch (e) {
      store.failAssistantStream(`Unexpected error: ${(e as Error).message}`);
    }
  }
}
