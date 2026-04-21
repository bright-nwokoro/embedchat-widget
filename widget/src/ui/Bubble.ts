import type { Store } from "../store";

const SVG_NS = "http://www.w3.org/2000/svg";

export function createBubble(store: Store): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "ec-bubble";
  btn.type = "button";
  btn.setAttribute("aria-label", "Open chat");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute(
    "d",
    "M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z",
  );
  svg.appendChild(path);
  btn.appendChild(svg);

  btn.addEventListener("click", () => store.togglePanel());
  return btn;
}
