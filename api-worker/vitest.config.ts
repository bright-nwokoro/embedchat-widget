import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          kvNamespaces: ["RATE_LIMIT"],
          bindings: {
            OPENAI_API_KEY: "test-openai-key",
            ANTHROPIC_API_KEY: "test-anthropic-key",
            SUPABASE_URL: "https://test.supabase.co",
            SUPABASE_ANON_KEY: "test-anon-key",
            ENVIRONMENT: "test",
          },
        },
      },
    },
  },
});
