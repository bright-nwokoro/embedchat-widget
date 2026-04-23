import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            SUPABASE_URL: "https://test.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
            OPENAI_API_KEY: "test-openai-key",
          },
        },
      },
    },
  },
});
