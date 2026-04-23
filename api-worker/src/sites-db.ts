import type { Env } from "../worker-configuration";
import type { SiteConfig, PublicModelId } from "./sites";

export const CACHE_TTL_MS = 10_000;

interface SiteRow {
  site_id: string;
  name: string | null;
  knowledge_source: string | null;
  status: string;
  chunk_count: number;
  last_indexed_at: string | null;
  allowed_origins: string[];
  system_prompt: string;
  allow_system_prompt_override: boolean;
  allowed_models: string[];
  default_model: string;
  max_message_chars: number;
  max_history_turns: number;
  max_output_tokens: number;
  error_message: string | null;
}

interface CacheEntry {
  site: SiteConfig | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearCache(): void {
  cache.clear();
}

function rowToSiteConfig(row: SiteRow): SiteConfig {
  const allowedOrigins: SiteConfig["allowedOrigins"] =
    row.allowed_origins.length === 1 && row.allowed_origins[0] === "*"
      ? "*"
      : row.allowed_origins;

  return {
    id: row.site_id,
    allowedOrigins,
    systemPrompt: row.system_prompt,
    allowSystemPromptOverride: row.allow_system_prompt_override,
    allowedModels: row.allowed_models as PublicModelId[],
    defaultModel: row.default_model as PublicModelId,
    maxMessageChars: row.max_message_chars,
    maxHistoryTurns: row.max_history_turns,
    maxOutputTokens: row.max_output_tokens,
  };
}

export async function getSite(env: Env, siteId: string): Promise<SiteConfig | null> {
  const now = Date.now();
  const hit = cache.get(siteId);
  if (hit && hit.expiresAt > now) return hit.site;

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/sites?select=*&site_id=eq.${encodeURIComponent(siteId)}&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      cache.set(siteId, { site: null, expiresAt: now + CACHE_TTL_MS });
      return null;
    }
    const rows = (await res.json()) as SiteRow[];
    const row = rows[0];
    const site = row ? rowToSiteConfig(row) : null;
    cache.set(siteId, { site, expiresAt: now + CACHE_TTL_MS });
    return site;
  } catch {
    cache.set(siteId, { site: null, expiresAt: now + CACHE_TTL_MS });
    return null;
  }
}
