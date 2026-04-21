import type { Store } from "../store";

export function createComposer(store: Store): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "ec-composer";

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Type a message…";
  textarea.rows = 1;
  form.appendChild(textarea);

  const button = document.createElement("button");
  button.type = "submit";
  button.textContent = "Send";
  form.appendChild(button);

  function updateDisabled() {
    const streaming = store.getState().ui.streaming;
    textarea.disabled = streaming;
    button.disabled = streaming || textarea.value.trim().length === 0;
  }

  textarea.addEventListener("input", updateDisabled);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text || store.getState().ui.streaming) return;
    textarea.value = "";
    updateDisabled();
    form.dispatchEvent(
      new CustomEvent("ec:send", { detail: text, bubbles: true }),
    );
  });

  store.subscribe(updateDisabled);
  updateDisabled();

  return form;
}
