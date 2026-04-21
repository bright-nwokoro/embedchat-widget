import type { Config } from "./types";

export function buildStyles(config: Config): string {
  const color = config.primaryColor;
  const posX = config.position === "bottom-left" ? "left: 20px;" : "right: 20px;";
  return `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111;
    }
    .ec-bubble {
      position: fixed;
      bottom: 20px;
      ${posX}
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: ${color};
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      border: none;
      z-index: 2147483646;
      transition: transform 120ms ease;
    }
    .ec-bubble:hover { transform: scale(1.05); }
    .ec-bubble svg { width: 24px; height: 24px; fill: white; }

    .ec-panel {
      position: fixed;
      bottom: 92px;
      ${posX}
      width: 360px;
      height: 520px;
      max-height: calc(100vh - 120px);
      background: white;
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483647;
      transform-origin: bottom right;
      transform: scale(0.95);
      opacity: 0;
      pointer-events: none;
      transition: opacity 120ms ease, transform 120ms ease;
    }
    .ec-panel.ec-open {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }

    .ec-header {
      padding: 16px;
      background: ${color};
      color: white;
      font-weight: 600;
      font-size: 15px;
    }

    .ec-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      background: #fafafa;
      font-size: 14px;
      line-height: 1.4;
    }
    .ec-msg {
      margin-bottom: 10px;
      display: flex;
    }
    .ec-msg-user { justify-content: flex-end; }
    .ec-msg-bubble {
      max-width: 80%;
      padding: 8px 12px;
      border-radius: 12px;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .ec-msg-user .ec-msg-bubble { background: ${color}; color: white; }
    .ec-msg-assistant .ec-msg-bubble { background: white; border: 1px solid #eee; }

    .ec-composer {
      display: flex;
      border-top: 1px solid #eee;
      padding: 8px;
      gap: 8px;
      background: white;
    }
    .ec-composer textarea {
      flex: 1;
      resize: none;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 8px 10px;
      font: inherit;
      min-height: 36px;
      max-height: 120px;
      outline: none;
    }
    .ec-composer textarea:focus { border-color: ${color}; }
    .ec-composer button {
      background: ${color};
      color: white;
      border: none;
      border-radius: 8px;
      padding: 0 16px;
      cursor: pointer;
      font-weight: 600;
    }
    .ec-composer button:disabled { opacity: 0.5; cursor: not-allowed; }
  `;
}
