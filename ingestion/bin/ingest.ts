import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ingest } from "../src/orchestrator";
import { DEMO_SOURCES } from "../src/sources/local-repo";
import type { IngestConfig } from "../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`ingest: missing required env var ${name}`);
    console.error(`Copy ingestion/.env.example to ingestion/.env and fill values.`);
    process.exit(1);
  }
  return v;
}

function parseArgs(argv: string[]): { dryRun: boolean; file: string | null } {
  const dryRun = argv.includes("--dry-run");
  const fileIdx = argv.indexOf("--file");
  const file = fileIdx !== -1 && argv[fileIdx + 1] ? argv[fileIdx + 1]! : null;
  return { dryRun, file };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const config: IngestConfig = {
    siteId: "demo-public",
    siteName: "Demo (EmbedChat repo)",
    knowledgeSource: "github.com/brightnwokoro/embedchat-widget",
    sources: DEMO_SOURCES,
    repoRoot: resolve(__dirname, "../.."),
    supabaseUrl: args.dryRun ? "" : getEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: args.dryRun ? "" : getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    openaiApiKey: args.dryRun ? "" : getEnv("OPENAI_API_KEY"),
  };

  const started = Date.now();
  const fileArg = args.file;
  const count = await ingest(config, {
    dryRun: args.dryRun,
    ...(fileArg ? { filter: (p: string) => p === fileArg } : {}),
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`ingest: done — ${count} chunks in ${elapsed}s`);
}

main().catch((e) => {
  console.error(`ingest failed: ${(e as Error).message}`);
  process.exit(1);
});
