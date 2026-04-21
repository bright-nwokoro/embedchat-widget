import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ingest } from "../src/orchestrator";
import type { IngestConfig } from "../src/types";

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function setupRepo(): string {
  const root = mkdtempSync(resolve(tmpdir(), "embedchat-ingest-"));
  writeFileSync(
    resolve(root, "README.md"),
    "# Title\n\n## Section\n\nOne paragraph only.\n",
  );
  mkdirSync(resolve(root, "pkg"), { recursive: true });
  writeFileSync(
    resolve(root, "pkg/foo.ts"),
    "export function foo(): number { return 1; }\n",
  );
  return root;
}

describe("ingest orchestrator", () => {
  let root: string;

  beforeEach(() => {
    root = setupRepo();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("reads → chunks → embeds → stores in order", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { embedding: new Array(1536).fill(0.1) },
            { embedding: new Array(1536).fill(0.2) },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const calls: string[] = [];
    const stub = {
      from: (tbl: string) => ({
        upsert: (_row: any) => {
          calls.push(`upsert:${tbl}`);
          return { error: null };
        },
        delete: () => ({
          eq: () => {
            calls.push(`delete:${tbl}`);
            return { error: null };
          },
        }),
        insert: (_rows: any) => {
          calls.push(`insert:${tbl}:${_rows.length}`);
          return { error: null };
        },
        update: (_patch: any) => ({
          eq: () => {
            calls.push(`update:${tbl}`);
            return { error: null };
          },
        }),
      }),
    } as any;

    const config: IngestConfig = {
      siteId: "demo-public",
      siteName: "Test Site",
      knowledgeSource: "test",
      sources: ["README.md", "pkg/foo.ts"],
      repoRoot: root,
      supabaseUrl: "https://fake.supabase.co",
      supabaseServiceRoleKey: "sr",
      openaiApiKey: "sk",
    };

    const count = await ingest(config, { supabaseClient: stub });
    expect(count).toBeGreaterThan(0);

    const u1 = calls.indexOf("upsert:sites");
    const d = calls.findIndex((c) => c.startsWith("delete:chunks"));
    const i = calls.findIndex((c) => c.startsWith("insert:chunks:"));
    const u2 = calls.findIndex((c) => c.startsWith("update:sites"));
    expect(u1).toBeGreaterThanOrEqual(0);
    expect(d).toBeGreaterThan(u1);
    expect(i).toBeGreaterThan(d);
    expect(u2).toBeGreaterThan(i);
  });

  it("throws if a source file doesn't exist", async () => {
    const config: IngestConfig = {
      siteId: "demo-public",
      siteName: "x",
      knowledgeSource: "x",
      sources: ["DOES-NOT-EXIST.md"],
      repoRoot: root,
      supabaseUrl: "https://fake",
      supabaseServiceRoleKey: "sr",
      openaiApiKey: "sk",
    };
    await expect(ingest(config, { supabaseClient: {} as any })).rejects.toThrow(
      /not found/,
    );
  });
});
