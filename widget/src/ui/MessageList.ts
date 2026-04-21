import type { Config, Message } from "../types";
import type { Store } from "../store";

export function createMessageList(config: Config, store: Store): HTMLDivElement {
  const list = document.createElement("div");
  list.className = "ec-messages";

  function render() {
    list.replaceChildren();
    const greeting: Message = { role: "assistant", content: config.greeting };
    for (const msg of [greeting, ...store.getState().messages]) {
      list.appendChild(renderMessage(msg));
    }
    list.scrollTop = list.scrollHeight;
  }

  store.subscribe(render);
  render();
  return list;
}

function renderMessage(msg: Message): HTMLDivElement {
  const row = document.createElement("div");
  row.className = `ec-msg ec-msg-${msg.role}`;
  const bubble = document.createElement("div");
  bubble.className = "ec-msg-bubble";
  bubble.textContent = msg.content;
  row.appendChild(bubble);
  return row;
}
