import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          kvNamespaces: ["RATE_LIMIT"],
          queueProducers: { INGEST_QUEUE: "embedchat-ingest" },
          bindings: {
            OPENAI_API_KEY: "test-openai-key",
            ANTHROPIC_API_KEY: "test-anthropic-key",
            SUPABASE_URL: "https://test.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
            ADMIN_API_KEY: "test-admin-api-key",
            ENVIRONMENT: "test",
          },
        },
      },
    },
  },
});
