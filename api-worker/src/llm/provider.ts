import type { ChatMessage, PublicModelId, StreamChunk } from "../types";

export interface StreamParams {
  systemPrompt: string;
  messages: ChatMessage[];
  maxTokens: number;
  apiKey: string;
}

export interface LLMProvider {
  stream(params: StreamParams): AsyncIterable<StreamChunk>;
}

export const MODEL_MAP: Record<
  PublicModelId,
  { provider: "openai" | "anthropic"; modelId: string }
> = {
  "gpt-4o-mini": { provider: "openai", modelId: "gpt-4o-mini" },
  "claude-haiku": { provider: "anthropic", modelId: "claude-haiku-4-5-20251001" },
};
