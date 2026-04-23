export interface Env {
  RATE_LIMIT: KVNamespace;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_API_KEY: string;
  INGEST_QUEUE: Queue<{ siteId: string; knowledgeUrl: string }>;
  ENVIRONMENT: string;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
