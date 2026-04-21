export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
  streaming?: boolean;
}

export type Position = "bottom-left" | "bottom-right";
export type ModelId = "gpt-4o-mini" | "claude-haiku";

export interface Config {
  siteId: string;
  apiUrl: string;
  primaryColor: string;
  greeting: string;
  systemPrompt: string | null;
  position: Position;
  model: ModelId;
  maxMessages: number;
  avatarUrl: string | null;
  knowledgeUrl: string | null;
}

export type StreamEvent =
  | { type: "token"; value: string }
  | { type: "done"; usage?: { inputTokens: number; outputTokens: number } }
  | { type: "error"; message: string };

export interface UIState {
  open: boolean;
  streaming: boolean;
}
