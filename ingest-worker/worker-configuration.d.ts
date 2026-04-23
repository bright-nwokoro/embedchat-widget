export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY: string;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
