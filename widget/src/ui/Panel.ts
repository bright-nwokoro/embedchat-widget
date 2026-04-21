import type { Config } from "../types";
import type { Store } from "../store";
import { createMessageList } from "./MessageList";
import { createComposer } from "./Composer";

export function createPanel(config: Config, store: Store): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "ec-panel";

  const header = document.createElement("div");
  header.className = "ec-header";
  header.textContent = "Chat";
  panel.appendChild(header);

  panel.appendChild(createMessageList(config, store));
  panel.appendChild(createComposer(store));

  store.subscribe(() => {
    panel.classList.toggle("ec-open", store.getState().ui.open);
  });

  return panel;
}
