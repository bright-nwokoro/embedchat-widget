import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Source } from "../types";

export const DEMO_SOURCES = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/DEPLOY.md",
  "docs/superpowers/specs/2026-04-21-embedchat-phase-1-design.md",
  "docs/superpowers/plans/2026-04-21-embedchat-phase-1.md",
  "docs/superpowers/specs/2026-04-21-embedchat-phase-2-design.md",
  "widget/src/config.ts",
  "widget/src/transport.ts",
  "widget/src/root.ts",
  "widget/src/store.ts",
  "api-worker/src/routes/chat.ts",
  "api-worker/src/routes/health.ts",
  "api-worker/src/prompt.ts",
  "api-worker/src/ratelimit.ts",
  "api-worker/src/llm/openai.ts",
  "api-worker/src/llm/anthropic.ts",
  "api-worker/src/llm/provider.ts",
  "api-worker/src/sites.ts",
];

export function readSources(repoRoot: string, paths: string[]): Source[] {
  const sources: Source[] = [];
  for (const p of paths) {
    const abs = resolve(repoRoot, p);
    if (!existsSync(abs)) {
      throw new Error(`ingestion: source not found: ${p} (expected at ${abs})`);
    }
    sources.push({ path: p, content: readFileSync(abs, "utf-8") });
  }
  return sources;
}
