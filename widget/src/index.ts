import { parseConfig } from "./config";
import { mount } from "./root";

function boot() {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) {
    console.error("EmbedChat: unable to locate script element");
    return;
  }
  try {
    const config = parseConfig(script);
    mount(config);
  } catch (e) {
    console.error((e as Error).message);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
