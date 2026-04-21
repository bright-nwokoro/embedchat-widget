export type Role = "user" | "assistant";
export type PublicModelId = "gpt-4o-mini" | "claude-haiku";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatRequest {
  siteId: string;
  messages: ChatMessage[];
  systemPrompt: string | null;
  model: PublicModelId;
  knowledgeUrl: string | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  usage?: Usage;
}

export interface SiteConfig {
  id: string;
  allowedOrigins: string[] | "*";
  systemPrompt: string;
  allowSystemPromptOverride: boolean;
  allowedModels: PublicModelId[];
  defaultModel: PublicModelId;
  maxMessageChars: number;
  maxHistoryTurns: number;
  maxOutputTokens: number;
}
