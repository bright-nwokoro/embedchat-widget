import type { Config, ModelId, Position } from "./types";

const VALID_POSITIONS: Position[] = ["bottom-left", "bottom-right"];
const VALID_MODELS: ModelId[] = ["gpt-4o-mini", "claude-haiku"];
const COLOR_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

const DEFAULTS = {
  primaryColor: "#7C5CFF",
  greeting: "Hi, how can I help?",
  position: "bottom-right" as Position,
  model: "gpt-4o-mini" as ModelId,
  maxMessages: 30,
};

export function parseConfig(script: HTMLScriptElement): Config {
  const get = (k: string) => script.getAttribute(k);
  const siteId = get("data-site-id");
  if (!siteId) throw new Error("EmbedChat: data-site-id is required");
  const apiUrl = get("data-api-url");
  if (!apiUrl) throw new Error("EmbedChat: data-api-url is required");

  const primaryColor = get("data-primary-color") ?? DEFAULTS.primaryColor;
  if (!COLOR_RE.test(primaryColor)) {
    throw new Error(`EmbedChat: invalid data-primary-color "${primaryColor}"`);
  }

  const position = (get("data-position") ?? DEFAULTS.position) as Position;
  if (!VALID_POSITIONS.includes(position)) {
    throw new Error(`EmbedChat: invalid data-position "${position}"`);
  }

  const model = (get("data-model") ?? DEFAULTS.model) as ModelId;
  if (!VALID_MODELS.includes(model)) {
    throw new Error(`EmbedChat: invalid data-model "${model}"`);
  }

  const maxMsgRaw = get("data-max-messages");
  let maxMessages = DEFAULTS.maxMessages;
  if (maxMsgRaw !== null) {
    const parsed = Number.parseInt(maxMsgRaw, 10);
    if (!Number.isInteger(parsed) || String(parsed) !== maxMsgRaw.trim() || parsed < 1) {
      throw new Error(`EmbedChat: invalid data-max-messages "${maxMsgRaw}"`);
    }
    maxMessages = parsed;
  }

  const knowledgeUrl = get("data-knowledge-url");
  if (knowledgeUrl) {
    console.info(
      "EmbedChat: data-knowledge-url is accepted but not active in Phase 1 (RAG grounding ships in Phase 2).",
    );
  }

  return Object.freeze({
    siteId,
    apiUrl,
    primaryColor,
    greeting: get("data-greeting") ?? DEFAULTS.greeting,
    systemPrompt: get("data-system-prompt"),
    position,
    model,
    maxMessages,
    avatarUrl: get("data-avatar-url"),
    knowledgeUrl,
  });
}
