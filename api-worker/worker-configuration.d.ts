export interface Env {
  RATE_LIMIT: KVNamespace;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ENVIRONMENT: string;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
