import type { PublicModelId } from "./types";

export type { PublicModelId };

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
