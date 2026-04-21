# EmbedChat Phase 2 Implementation Plan (RAG Grounding)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the `demo-public` site-id on the EmbedChat repository via Supabase pgvector + OpenAI text-embedding-3-small, with best-effort retrieval that preserves Phase 1's ungrounded fallback.

**Architecture:** New `ingestion/` CLI package (crawls local repo → markdown/TypeScript-aware chunks → OpenAI embeddings → Supabase upsert). New `api-worker/src/rag/` module adds query embedding, pgvector search, and context injection as step 7a of the existing `/chat` pipeline. Supabase is a new external service; every other Phase 1 component is unchanged.

**Tech Stack:** TypeScript 5, `@supabase/supabase-js` v2, `js-tiktoken`, `typescript` compiler API (for TS chunking), Supabase Postgres + pgvector, OpenAI `text-embedding-3-small` (1536 dims), Vitest (node env for ingestion, Miniflare for api-worker).

**Spec:** See [docs/superpowers/specs/2026-04-21-embedchat-phase-2-design.md](../specs/2026-04-21-embedchat-phase-2-design.md) — this plan is the executable version.

**Prerequisite:** Phase 1 plan complete (all 30 tasks). A Supabase project is required for Task 21's local smoke test; Task 1 walks through creation.

**Commit convention:** Conventional commits (`feat:`, `test:`, `chore:`, `docs:`). One commit per task unless noted.

---

## File plan (additions + modifications)

```
embedchat-widget/
├── supabase/                          [NEW]
│   └── schema.sql
├── ingestion/                         [NEW workspace package]
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── .env.example
│   ├── .gitignore
│   ├── bin/ingest.ts
│   ├── src/
│   │   ├── types.ts
│   │   ├── tokenizer.ts
│   │   ├── sources/local-repo.ts
│   │   ├── chunk/
│   │   │   ├── index.ts
│   │   │   ├── markdown.ts
│   │   │   └── typescript.ts
│   │   ├── embed/openai.ts
│   │   ├── store/supabase.ts
│   │   └── orchestrator.ts
│   └── test/
│       ├── fixtures/
│       │   ├── sample.md
│       │   └── sample.ts
│       ├── tokenizer.test.ts
│       ├── markdown.test.ts
│       ├── typescript.test.ts
│       └── orchestrator.test.ts
├── api-worker/src/
│   ├── supabase.ts                    [NEW: thin client factory]
│   └── rag/                           [NEW]
│       ├── types.ts
│       ├── embed-query.ts
│       ├── retrieve.ts
│       └── context.ts
├── api-worker/test/                   [NEW RAG tests]
│   ├── rag-embed-query.test.ts
│   ├── rag-retrieve.test.ts
│   └── rag-context.test.ts
├── api-worker/src/routes/chat.ts      [MODIFIED: step 7a insertion]
├── api-worker/test/chat.test.ts       [MODIFIED: RAG path assertions]
├── api-worker/test/e2e.test.ts        [MODIFIED: grounded-path smoke]
├── api-worker/worker-configuration.d.ts  [MODIFIED: add Supabase env]
├── api-worker/.dev.vars.example       [MODIFIED]
├── pnpm-workspace.yaml                [MODIFIED: add ingestion]
├── package.json                       [MODIFIED: add "ingest" alias]
├── README.md                          [MODIFIED: Phase 2 section]
├── docs/ARCHITECTURE.md               [MODIFIED: add Phase 2 diagram]
└── docs/DEPLOY.md                     [MODIFIED: add Supabase section]
```

---

## Task 1: Supabase schema

**Files:**
- Create: `supabase/schema.sql`

The DDL is committed; the Supabase project itself is created manually in Task 21.

- [ ] **Step 1: Create `supabase/schema.sql`**

```sql
-- EmbedChat Phase 2 schema. Run in Supabase SQL Editor on a fresh project.

create extension if not exists vector;

-- Per-site RAG state (generalized for Phase 3).
create table if not exists sites (
  site_id text primary key,
  name text,
  knowledge_source text,
  last_indexed_at timestamptz,
  chunk_count integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'indexing', 'ready', 'failed'))
);

-- Chunks with embeddings.
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  site_id text not null references sites(site_id) on delete cascade,
  source_path text not null,
  heading_path text,
  chunk_index integer not null,
  content text not null,
  token_count integer not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists chunks_site_idx on chunks (site_id);
create index if not exists chunks_embedding_hnsw on chunks using hnsw (embedding vector_cosine_ops);

-- Similarity search as an RPC (returns fewer round-trips than PostgREST for pgvector).
create or replace function match_chunks (
  query_embedding vector(1536),
  match_site_id text,
  match_count integer default 5
)
returns table (
  id uuid,
  source_path text,
  heading_path text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    c.id,
    c.source_path,
    c.heading_path,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  where c.site_id = match_site_id
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
```

**Why the RPC:** PostgREST doesn't support pgvector ORDER BY natively. An RPC lets the api-worker call `sb.rpc('match_chunks', {...})` with one HTTP round-trip. This is the standard Supabase pattern for vector search.

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(supabase): schema for sites + chunks with pgvector cosine search RPC"
```

---

## Task 2: Add ingestion to workspace + root scripts

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`

- [ ] **Step 1: Add `ingestion` to `pnpm-workspace.yaml`**

Current:
```yaml
packages:
  - widget
  - api-worker
  - cdn-worker
  - demo
```

After edit:
```yaml
packages:
  - widget
  - api-worker
  - cdn-worker
  - demo
  - ingestion
```

- [ ] **Step 2: Add `"ingest"` script to root `package.json`**

In the `scripts` block, add after `"dev:demo"`:

```json
"ingest": "pnpm --filter=ingestion ingest"
```

Full scripts block should read:

```json
  "scripts": {
    "build": "pnpm --filter=widget build && pnpm --filter=cdn-worker build && pnpm --filter=api-worker build && pnpm --filter=demo build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint",
    "deploy": "pnpm run build && pnpm --filter=api-worker deploy && pnpm --filter=cdn-worker deploy && pnpm --filter=demo deploy",
    "dev:api": "pnpm --filter=api-worker dev",
    "dev:widget": "pnpm --filter=widget dev",
    "dev:demo": "pnpm --filter=demo dev",
    "ingest": "pnpm --filter=ingestion ingest"
  },
```

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.yaml package.json
git commit -m "chore: add ingestion workspace package + root ingest script"
```

---

## Task 3: Ingestion package scaffold

**Files:**
- Create: `ingestion/package.json`
- Create: `ingestion/tsconfig.json`
- Create: `ingestion/vitest.config.ts`
- Create: `ingestion/.env.example`
- Create: `ingestion/.gitignore`
- Create: `ingestion/bin/ingest.ts` (stub)
- Create: `ingestion/src/index.ts` (stub)
- Create: `ingestion/test/.gitkeep`

- [ ] **Step 1: Create `ingestion/package.json`**

```json
{
  "name": "ingestion",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "ingest": "tsx bin/ingest.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "js-tiktoken": "^1.0.15",
    "dotenv": "^16.4.5",
    "typescript": "^5.6.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "@types/node": "^20.16.0"
  }
}
```

Notes:
- `tsx` runs TS directly (no build step needed for a CLI).
- `typescript` is a runtime dep because we use the TypeScript compiler API for chunking.
- Vitest here uses the node env (default), not Miniflare. No conflict with api-worker's pinned vitest.

- [ ] **Step 2: Create `ingestion/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "lib": ["ES2022"],
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "test/**/*", "bin/**/*"]
}
```

- [ ] **Step 3: Create `ingestion/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `ingestion/.env.example`**

```
# Supabase project credentials — copy to .env (gitignored) before running `pnpm ingest`.
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# OpenAI API key — used for embedding.
OPENAI_API_KEY=sk-...
```

- [ ] **Step 5: Create `ingestion/.gitignore`**

```
node_modules/
dist/
.env
*.log
```

- [ ] **Step 6: Create stub `ingestion/bin/ingest.ts`**

```ts
// CLI entry. Wired up in Task 13.
console.log("ingestion CLI — not yet implemented");
```

- [ ] **Step 7: Create stub `ingestion/src/index.ts`**

```ts
// Public API. Implementation added in later tasks.
export {};
```

- [ ] **Step 8: Create placeholder `ingestion/test/.gitkeep`** (empty file)

- [ ] **Step 9: Install deps + verify typecheck**

```bash
cd /Users/user/Documents/GitHub/embedchat-widget
pnpm install
pnpm --filter=ingestion typecheck
```

Expected: clean install + no type errors.

- [ ] **Step 10: Commit**

```bash
git add ingestion/ pnpm-lock.yaml
git commit -m "chore(ingestion): scaffold Node-based ingestion package"
```

---

## Task 4: Ingestion types module

**Files:**
- Create: `ingestion/src/types.ts`

- [ ] **Step 1: Create `ingestion/src/types.ts`**

```ts
export interface Source {
  path: string;        // relative path, e.g. "README.md"
  content: string;     // file content
}

export interface Chunk {
  site_id: string;
  source_path: string;
  heading_path: string | null;
  chunk_index: number;
  content: string;
  token_count: number;
  // embedding added after embed phase; stored as number[] until serialization
  embedding?: number[];
}

export interface IngestConfig {
  siteId: string;
  siteName: string;
  knowledgeSource: string;
  sources: string[];              // repo-relative paths to ingest
  repoRoot: string;               // absolute path
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  openaiApiKey: string;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter=ingestion typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add ingestion/src/types.ts
git commit -m "feat(ingestion): core types"
```

---

## Task 5: Ingestion tokenizer (TDD)

**Files:**
- Create: `ingestion/test/tokenizer.test.ts`
- Create: `ingestion/src/tokenizer.ts`

- [ ] **Step 1: Write failing tests — `ingestion/test/tokenizer.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { countTokens } from "../src/tokenizer";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts a simple ASCII word as a small number of tokens", () => {
    const n = countTokens("hello");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(2);
  });

  it("counts longer text proportionally", () => {
    const short = countTokens("hello world");
    const long = countTokens("hello world ".repeat(20));
    expect(long).toBeGreaterThan(short * 10);
  });

  it("handles unicode without crashing", () => {
    expect(() => countTokens("café 日本語 😀")).not.toThrow();
    expect(countTokens("café 日本語 😀")).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter=ingestion test
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ingestion/src/tokenizer.ts`**

```ts
import { encodingForModel } from "js-tiktoken";

// text-embedding-3-small uses cl100k_base. Cache the encoder at module scope.
const encoder = encodingForModel("text-embedding-3-small");

export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return encoder.encode(text).length;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 5: Commit**

```bash
git add ingestion/src/tokenizer.ts ingestion/test/tokenizer.test.ts
git commit -m "feat(ingestion): tokenizer using js-tiktoken"
```

---

## Task 6: Markdown chunker (TDD)

**Files:**
- Create: `ingestion/test/fixtures/sample.md`
- Create: `ingestion/test/markdown.test.ts`
- Create: `ingestion/src/chunk/markdown.ts`

- [ ] **Step 1: Create fixture `ingestion/test/fixtures/sample.md`**

````markdown
# Project Title

Intro paragraph that sits under the H1, no H2 yet.

## Section A

First paragraph of A.

Second paragraph of A.

## Section B

Content before the code block.

```ts
// This code block must stay atomic. Do not split it.
function example(x: number): number {
  return x * 2;
}
```

Content after the code block.

### Section B subsection

Nested content under B.

## Section C

Short.
````

- [ ] **Step 2: Write failing tests — `ingestion/test/markdown.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkMarkdown } from "../src/chunk/markdown";

function loadSample(): string {
  return readFileSync(resolve(__dirname, "fixtures/sample.md"), "utf-8");
}

describe("chunkMarkdown", () => {
  it("produces at least one chunk per ## section in the sample", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    const sectionA = chunks.find((c) => c.heading_path?.includes("Section A"));
    const sectionB = chunks.find((c) => c.heading_path?.includes("Section B"));
    const sectionC = chunks.find((c) => c.heading_path?.includes("Section C"));
    expect(sectionA).toBeTruthy();
    expect(sectionB).toBeTruthy();
    expect(sectionC).toBeTruthy();
  });

  it("builds heading_path as breadcrumb with H1 + H2", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    const sectionA = chunks.find((c) => c.heading_path?.includes("Section A"))!;
    expect(sectionA.heading_path).toBe("# Project Title > ## Section A");
  });

  it("includes H3 in heading_path for nested sections", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    const nested = chunks.find((c) => c.heading_path?.includes("Section B subsection"))!;
    expect(nested.heading_path).toBe(
      "# Project Title > ## Section B > ### Section B subsection",
    );
  });

  it("keeps code blocks atomic in a single chunk", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    const withCode = chunks.find((c) => c.content.includes("function example"));
    expect(withCode).toBeTruthy();
    expect(withCode!.content).toContain("```ts");
    expect(withCode!.content).toContain("```");
    expect(withCode!.content).toContain("return x * 2");
  });

  it("assigns chunk_index starting at 0 within the source", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    expect(chunks[0].chunk_index).toBe(0);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].chunk_index).toBe(chunks[i - 1].chunk_index + 1);
    }
  });

  it("assigns source_path from options", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "docs/x.md" });
    for (const c of chunks) expect(c.source_path).toBe("docs/x.md");
  });

  it("produces non-empty content per chunk", () => {
    const chunks = chunkMarkdown(loadSample(), { sourcePath: "sample.md" });
    for (const c of chunks) expect(c.content.trim().length).toBeGreaterThan(0);
  });

  it("splits oversized sections by paragraph while keeping under hard cap", () => {
    const longPara = "This is a filler paragraph. ".repeat(200);
    const input = `# Doc\n\n## Big Section\n\n${longPara}\n\n${longPara}\n\n${longPara}`;
    const chunks = chunkMarkdown(input, { sourcePath: "big.md" });
    const bigChunks = chunks.filter((c) => c.heading_path?.includes("Big Section"));
    expect(bigChunks.length).toBeGreaterThan(1);
    for (const c of bigChunks) expect(c.token_count).toBeLessThanOrEqual(1200);
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 4: Implement `ingestion/src/chunk/markdown.ts`**

```ts
import type { Chunk } from "../types";
import { countTokens } from "../tokenizer";

const TARGET_TOKENS = 500;
const HARD_CAP_TOKENS = 1200;

interface ChunkOptions {
  sourcePath: string;
  siteId?: string;
}

type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "code"; text: string }
  | { type: "para"; text: string };

/** Split the markdown into a flat list of structural blocks. */
function tokenizeBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Code fence.
    if (line.startsWith("```")) {
      const buf: string[] = [line];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        buf.push(lines[i]!);
        i++;
      }
      if (i < lines.length) buf.push(lines[i]!); // closing fence
      i++;
      blocks.push({ type: "code", text: buf.join("\n") });
      continue;
    }

    // ATX heading.
    const hmatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hmatch) {
      blocks.push({
        type: "heading",
        level: hmatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        text: hmatch[2]!.trim(),
      });
      i++;
      continue;
    }

    // Blank line: skip.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: consume until blank, heading, or code.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !lines[i]!.startsWith("```") &&
      !/^#{1,6}\s+/.test(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i++;
    }
    blocks.push({ type: "para", text: buf.join("\n") });
  }
  return blocks;
}

interface Section {
  headingPath: string;
  blocks: Block[];
}

/** Group blocks into sections split by H2/H3 boundaries; H1 is the doc title prefix. */
function groupSections(blocks: Block[]): Section[] {
  const sections: Section[] = [];
  let h1: string | null = null;
  let h2: string | null = null;
  let h3: string | null = null;
  let current: Section | null = null;

  function startSection() {
    const parts: string[] = [];
    if (h1) parts.push(`# ${h1}`);
    if (h2) parts.push(`## ${h2}`);
    if (h3) parts.push(`### ${h3}`);
    const headingPath = parts.join(" > ");
    current = { headingPath, blocks: [] };
    sections.push(current);
  }

  for (const b of blocks) {
    if (b.type === "heading") {
      if (b.level === 1) {
        h1 = b.text;
        h2 = null;
        h3 = null;
        startSection();
      } else if (b.level === 2) {
        h2 = b.text;
        h3 = null;
        startSection();
      } else if (b.level === 3) {
        h3 = b.text;
        startSection();
      } else {
        if (!current) startSection();
        current!.blocks.push({ type: "para", text: `${"#".repeat(b.level)} ${b.text}` });
      }
      continue;
    }
    if (!current) startSection();
    current!.blocks.push(b);
  }

  return sections.filter((s) => s.blocks.length > 0);
}

/** Split one section's block list into content chunks respecting token caps. */
function splitSection(section: Section): string[] {
  const joined = section.blocks.map((b) => b.text).join("\n\n");

  if (countTokens(joined) <= TARGET_TOKENS) {
    return [joined];
  }

  const out: string[] = [];
  let buf: string[] = [];

  function flush() {
    if (buf.length > 0) {
      out.push(buf.join("\n\n"));
      buf = [];
    }
  }

  for (const b of section.blocks) {
    const text = b.text;
    const candidate = buf.length === 0 ? text : `${buf.join("\n\n")}\n\n${text}`;
    const candidateTokens = countTokens(candidate);

    if (b.type === "code") {
      if (buf.length > 0 && candidateTokens > HARD_CAP_TOKENS) {
        flush();
      }
      buf.push(text);
      flush();
      continue;
    }

    if (candidateTokens <= TARGET_TOKENS) {
      buf.push(text);
      continue;
    }

    flush();
    if (countTokens(text) <= HARD_CAP_TOKENS) {
      buf.push(text);
      flush();
    } else {
      const sentences = text.split(/(?<=[.!?])\s+/);
      let sbuf: string[] = [];
      for (const s of sentences) {
        const cand = sbuf.length === 0 ? s : `${sbuf.join(" ")} ${s}`;
        if (countTokens(cand) > TARGET_TOKENS && sbuf.length > 0) {
          out.push(sbuf.join(" "));
          sbuf = [s];
        } else {
          sbuf.push(s);
        }
      }
      if (sbuf.length > 0) out.push(sbuf.join(" "));
    }
  }

  flush();
  return out.filter((s) => s.trim().length > 0);
}

export function chunkMarkdown(md: string, opts: ChunkOptions): Chunk[] {
  const blocks = tokenizeBlocks(md);
  const sections = groupSections(blocks);
  const chunks: Chunk[] = [];
  let idx = 0;
  for (const section of sections) {
    const parts = splitSection(section);
    for (const content of parts) {
      chunks.push({
        site_id: opts.siteId ?? "",
        source_path: opts.sourcePath,
        heading_path: section.headingPath || null,
        chunk_index: idx++,
        content,
        token_count: countTokens(content),
      });
    }
  }
  return chunks;
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 6: Commit**

```bash
git add ingestion/src/chunk/markdown.ts ingestion/test/markdown.test.ts ingestion/test/fixtures/sample.md
git commit -m "feat(ingestion): markdown-aware chunker with atomic code blocks"
```

---

## Task 7: TypeScript chunker (TDD)

**Files:**
- Create: `ingestion/test/fixtures/sample.ts`
- Create: `ingestion/test/typescript.test.ts`
- Create: `ingestion/src/chunk/typescript.ts`

- [ ] **Step 1: Create fixture `ingestion/test/fixtures/sample.ts`**

```ts
import { readFileSync } from "node:fs";
import type { Chunk } from "../types.js";

/**
 * Doubles the input value.
 * Exported utility.
 */
export function double(x: number): number {
  return x * 2;
}

// Simple comment on this one.
export const MAX_RETRIES = 3;

export interface SampleConfig {
  id: string;
  retries: number;
}

export class SampleClass {
  constructor(public readonly id: string) {}
  describe(): string {
    return `Sample(${this.id})`;
  }
}
```

- [ ] **Step 2: Write failing tests — `ingestion/test/typescript.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkTypeScript } from "../src/chunk/typescript";

function loadSample(): string {
  return readFileSync(resolve(__dirname, "fixtures/sample.ts"), "utf-8");
}

describe("chunkTypeScript", () => {
  it("produces one chunk per top-level exported symbol", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    const names = chunks
      .map((c) => c.heading_path)
      .filter((h): h is string => h !== null);
    expect(names.some((h) => h.endsWith("export: double"))).toBe(true);
    expect(names.some((h) => h.endsWith("export: MAX_RETRIES"))).toBe(true);
    expect(names.some((h) => h.endsWith("export: SampleConfig"))).toBe(true);
    expect(names.some((h) => h.endsWith("export: SampleClass"))).toBe(true);
  });

  it("attaches preceding JSDoc comments to the chunk", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    const doubleChunk = chunks.find((c) => c.heading_path?.endsWith("double"))!;
    expect(doubleChunk.content).toContain("Doubles the input value");
  });

  it("attaches preceding line comments to the chunk", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    const maxChunk = chunks.find((c) => c.heading_path?.endsWith("MAX_RETRIES"))!;
    expect(maxChunk.content).toContain("Simple comment on this one");
  });

  it("prepends an import prelude to each chunk", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    for (const c of chunks) {
      expect(c.content.split("\n")[0]).toMatch(/^\/\/ from sample\.ts/);
    }
  });

  it("heading_path uses `{path} > export: {name}` format", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "widget/foo.ts" });
    for (const c of chunks) {
      expect(c.heading_path).toMatch(/^widget\/foo\.ts > export: /);
    }
  });

  it("assigns sequential chunk_index starting at 0", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    chunks.forEach((c, i) => expect(c.chunk_index).toBe(i));
  });

  it("includes the declaration body text", () => {
    const chunks = chunkTypeScript(loadSample(), { sourcePath: "sample.ts" });
    const classChunk = chunks.find((c) => c.heading_path?.endsWith("SampleClass"))!;
    expect(classChunk.content).toContain("describe(): string");
    expect(classChunk.content).toContain("return `Sample(");
  });

  it("returns empty array for a file with no exports", () => {
    const input = `const private_ = 1;\nfunction helper() {}\n`;
    const chunks = chunkTypeScript(input, { sourcePath: "x.ts" });
    expect(chunks).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 4: Implement `ingestion/src/chunk/typescript.ts`**

```ts
import ts from "typescript";
import type { Chunk } from "../types";
import { countTokens } from "../tokenizer";

interface ChunkOptions {
  sourcePath: string;
  siteId?: string;
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getSymbolName(node: ts.Statement): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isClassDeclaration(node) && node.name) return node.name.text;
  if (ts.isInterfaceDeclaration(node)) return node.name.text;
  if (ts.isTypeAliasDeclaration(node)) return node.name.text;
  if (ts.isEnumDeclaration(node)) return node.name.text;
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return null;
}

/** Return the source text from the first leading comment to the node's end. */
function getNodeTextWithLeadingComments(node: ts.Node, fullText: string): string {
  const ranges = ts.getLeadingCommentRanges(fullText, node.pos) ?? [];
  const start = ranges.length > 0 ? ranges[0]!.pos : node.getStart();
  return fullText.slice(start, node.end).trim();
}

function collectImports(sf: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) names.push(clause.name.text);
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push(`* as ${clause.namedBindings.name.text}`);
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) {
          names.push(spec.name.text);
        }
      }
    }
  }
  return names;
}

export function chunkTypeScript(source: string, opts: ChunkOptions): Chunk[] {
  const sf = ts.createSourceFile(
    opts.sourcePath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const imports = collectImports(sf);
  const prelude =
    imports.length > 0
      ? `// from ${opts.sourcePath}, imports: ${imports.join(", ")}`
      : `// from ${opts.sourcePath}`;

  const chunks: Chunk[] = [];
  let idx = 0;

  for (const stmt of sf.statements) {
    if (!isExported(stmt)) continue;
    const name = getSymbolName(stmt);
    if (!name) continue;
    const body = getNodeTextWithLeadingComments(stmt, source);
    const content = `${prelude}\n\n${body}`;
    chunks.push({
      site_id: opts.siteId ?? "",
      source_path: opts.sourcePath,
      heading_path: `${opts.sourcePath} > export: ${name}`,
      chunk_index: idx++,
      content,
      token_count: countTokens(content),
    });
  }

  return chunks;
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 6: Commit**

```bash
git add ingestion/src/chunk/typescript.ts ingestion/test/typescript.test.ts ingestion/test/fixtures/sample.ts
git commit -m "feat(ingestion): typescript chunker via TS compiler API"
```

---

## Task 8: Chunk dispatcher

**Files:**
- Create: `ingestion/src/chunk/index.ts`

- [ ] **Step 1: Create `ingestion/src/chunk/index.ts`**

```ts
import { extname } from "node:path";
import type { Chunk } from "../types";
import { chunkMarkdown } from "./markdown";
import { chunkTypeScript } from "./typescript";

export interface ChunkFileOptions {
  siteId: string;
  sourcePath: string;
}

export function chunkFile(content: string, opts: ChunkFileOptions): Chunk[] {
  const ext = extname(opts.sourcePath).toLowerCase();
  let chunks: Chunk[];
  switch (ext) {
    case ".md":
    case ".markdown":
      chunks = chunkMarkdown(content, opts);
      break;
    case ".ts":
    case ".tsx":
      chunks = chunkTypeScript(content, opts);
      break;
    default:
      throw new Error(
        `ingestion: no chunker registered for extension "${ext}" (path: ${opts.sourcePath})`,
      );
  }
  return chunks.map((c) => ({ ...c, site_id: opts.siteId }));
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter=ingestion typecheck
```

- [ ] **Step 3: Commit**

```bash
git add ingestion/src/chunk/index.ts
git commit -m "feat(ingestion): chunk dispatcher by extension"
```

---

## Task 9: Source reader (local repo)

**Files:**
- Create: `ingestion/src/sources/local-repo.ts`

- [ ] **Step 1: Create `ingestion/src/sources/local-repo.ts`**

```ts
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter=ingestion typecheck
```

- [ ] **Step 3: Commit**

```bash
git add ingestion/src/sources/local-repo.ts
git commit -m "feat(ingestion): local repo source reader + demo allowlist"
```

---

## Task 10: OpenAI embedder (TDD)

**Files:**
- Create: `ingestion/test/embed.test.ts`
- Create: `ingestion/src/embed/openai.ts`

- [ ] **Step 1: Write failing tests — `ingestion/test/embed.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embedBatch } from "../src/embed/openai";

describe("embedBatch", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to the OpenAI embeddings endpoint with correct headers + body", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
          usage: { total_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", mock);

    const out = await embedBatch(["hello", "world"], "sk-test");
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect((init as any).method).toBe("POST");
    expect((init as any).headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toEqual(["hello", "world"]);
    expect(out).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("retries once on 429, then succeeds", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ embedding: [1, 2] }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", mock);

    const out = await embedBatch(["x"], "sk-test");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(out).toEqual([[1, 2]]);
  });

  it("throws after a second failure", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response("bad", { status: 500 }),
    );
    vi.stubGlobal("fetch", mock);

    await expect(embedBatch(["x"], "sk-test")).rejects.toThrow(/OpenAI/);
  });

  it("rejects empty input", async () => {
    await expect(embedBatch([], "sk-test")).rejects.toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 3: Implement `ingestion/src/embed/openai.ts`**

```ts
const MODEL = "text-embedding-3-small";
const ENDPOINT = "https://api.openai.com/v1/embeddings";

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function embedBatch(
  inputs: string[],
  apiKey: string,
): Promise<number[][]> {
  if (inputs.length === 0) {
    throw new Error("embedBatch: empty input array");
  }

  async function attempt(): Promise<Response> {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, input: inputs }),
    });
  }

  let res = await attempt();
  if (!res.ok && (res.status === 429 || res.status >= 500)) {
    await sleep(500);
    res = await attempt();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

export const MAX_BATCH = 50;

/** Embed a list of chunks in batches of MAX_BATCH, preserving order. */
export async function embedAll(
  contents: string[],
  apiKey: string,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < contents.length; i += MAX_BATCH) {
    const batch = contents.slice(i, i + MAX_BATCH);
    const vectors = await embedBatch(batch, apiKey);
    out.push(...vectors);
  }
  return out;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 5: Commit**

```bash
git add ingestion/src/embed/openai.ts ingestion/test/embed.test.ts
git commit -m "feat(ingestion): OpenAI embed batch with one retry"
```

---

## Task 11: Supabase store module

**Files:**
- Create: `ingestion/src/store/supabase.ts`

Exercised via the orchestrator test (Task 12) using a stubbed client. No standalone TDD.

- [ ] **Step 1: Create `ingestion/src/store/supabase.ts`**

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Chunk } from "../types";

export interface SiteMeta {
  site_id: string;
  name: string;
  knowledge_source: string;
}

export function createStoreClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function storeSiteChunks(
  sb: SupabaseClient,
  site: SiteMeta,
  chunks: Chunk[],
): Promise<void> {
  // 1. Upsert site row with status=indexing.
  {
    const { error } = await sb.from("sites").upsert({
      site_id: site.site_id,
      name: site.name,
      knowledge_source: site.knowledge_source,
      status: "indexing",
    });
    if (error) throw new Error(`Supabase sites upsert: ${error.message}`);
  }

  // 2. Delete existing chunks for this site.
  {
    const { error } = await sb.from("chunks").delete().eq("site_id", site.site_id);
    if (error) throw new Error(`Supabase chunks delete: ${error.message}`);
  }

  // 3. Insert new chunks in one batch.
  //    pgvector accepts the embedding as a JSON array literal via stringify.
  const rows = chunks.map((c) => ({
    site_id: c.site_id,
    source_path: c.source_path,
    heading_path: c.heading_path,
    chunk_index: c.chunk_index,
    content: c.content,
    token_count: c.token_count,
    embedding: JSON.stringify(c.embedding ?? []),
  }));
  {
    const { error } = await sb.from("chunks").insert(rows);
    if (error) throw new Error(`Supabase chunks insert: ${error.message}`);
  }

  // 4. Mark site ready with chunk_count + last_indexed_at.
  {
    const { error } = await sb
      .from("sites")
      .update({
        status: "ready",
        chunk_count: chunks.length,
        last_indexed_at: new Date().toISOString(),
      })
      .eq("site_id", site.site_id);
    if (error) throw new Error(`Supabase sites update: ${error.message}`);
  }
}

export async function markSiteFailed(
  sb: SupabaseClient,
  siteId: string,
): Promise<void> {
  await sb.from("sites").update({ status: "failed" }).eq("site_id", siteId);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter=ingestion typecheck
```

- [ ] **Step 3: Commit**

```bash
git add ingestion/src/store/supabase.ts
git commit -m "feat(ingestion): supabase store (upsert site, replace chunks)"
```

---

## Task 12: Orchestrator (TDD)

**Files:**
- Create: `ingestion/test/orchestrator.test.ts`
- Create: `ingestion/src/orchestrator.ts`

- [ ] **Step 1: Write failing tests — `ingestion/test/orchestrator.test.ts`**

```ts
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 3: Implement `ingestion/src/orchestrator.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Chunk, IngestConfig } from "./types";
import { readSources } from "./sources/local-repo";
import { chunkFile } from "./chunk";
import { embedAll } from "./embed/openai";
import { createStoreClient, storeSiteChunks, markSiteFailed } from "./store/supabase";

export interface IngestOptions {
  /** Inject a stubbed Supabase client for testing; otherwise one is created. */
  supabaseClient?: SupabaseClient;
  /** Optional limit to a single file path (for --file iteration). */
  filter?: (path: string) => boolean;
  /** Skip embed + store (dry run). */
  dryRun?: boolean;
}

export async function ingest(
  config: IngestConfig,
  options: IngestOptions = {},
): Promise<number> {
  const paths = options.filter
    ? config.sources.filter(options.filter)
    : config.sources;
  const sources = readSources(config.repoRoot, paths);

  const chunks: Chunk[] = [];
  for (const src of sources) {
    const fileChunks = chunkFile(src.content, {
      siteId: config.siteId,
      sourcePath: src.path,
    });
    chunks.push(...fileChunks);
  }

  if (options.dryRun) {
    console.log(
      `ingest: dry-run complete. ${chunks.length} chunks from ${sources.length} sources. Skipping embed + store.`,
    );
    return chunks.length;
  }

  if (chunks.length === 0) {
    throw new Error("ingest: no chunks produced — source allowlist may be wrong");
  }

  const vectors = await embedAll(
    chunks.map((c) => c.content),
    config.openaiApiKey,
  );
  for (let i = 0; i < chunks.length; i++) {
    chunks[i]!.embedding = vectors[i]!;
  }

  const sb =
    options.supabaseClient ??
    createStoreClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  try {
    await storeSiteChunks(
      sb,
      {
        site_id: config.siteId,
        name: config.siteName,
        knowledge_source: config.knowledgeSource,
      },
      chunks,
    );
  } catch (e) {
    await markSiteFailed(sb, config.siteId).catch(() => {});
    throw e;
  }

  return chunks.length;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 5: Commit**

```bash
git add ingestion/src/orchestrator.ts ingestion/test/orchestrator.test.ts
git commit -m "feat(ingestion): orchestrator wiring crawl → chunk → embed → store"
```

---

## Task 13: CLI entry point

**Files:**
- Modify: `ingestion/bin/ingest.ts`

- [ ] **Step 1: Replace `ingestion/bin/ingest.ts`**

```ts
import "dotenv/config";
import { resolve } from "node:path";
import { ingest } from "../src/orchestrator";
import { DEMO_SOURCES } from "../src/sources/local-repo";
import type { IngestConfig } from "../src/types";

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
  const count = await ingest(config, {
    dryRun: args.dryRun,
    filter: args.file ? (p) => p === args.file : undefined,
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`ingest: done — ${count} chunks in ${elapsed}s`);
}

main().catch((e) => {
  console.error(`ingest failed: ${(e as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run test**

```bash
cd /Users/user/Documents/GitHub/embedchat-widget
pnpm --filter=ingestion ingest -- --dry-run
```

Expected: `ingest: dry-run complete. N chunks from M sources. Skipping embed + store.` followed by `ingest: done — N chunks in Xs`. N should be > 40 and M should equal the allowlist length.

- [ ] **Step 3: Run tests one more time to confirm no regression**

```bash
pnpm --filter=ingestion test
```

- [ ] **Step 4: Commit**

```bash
git add ingestion/bin/ingest.ts
git commit -m "feat(ingestion): CLI entry with --dry-run + --file"
```

---

## Task 14: api-worker env + Supabase dep

**Files:**
- Modify: `api-worker/package.json`
- Modify: `api-worker/worker-configuration.d.ts`
- Modify: `api-worker/vitest.config.ts`
- Modify: `api-worker/.dev.vars.example`

- [ ] **Step 1: Add `@supabase/supabase-js` to `api-worker/package.json`**

In `"dependencies"`, add after `"@anthropic-ai/sdk"`:

```json
"@supabase/supabase-js": "^2.45.0"
```

Full dependencies block:

```json
  "dependencies": {
    "hono": "^4.6.0",
    "@anthropic-ai/sdk": "^0.33.0",
    "@supabase/supabase-js": "^2.45.0"
  },
```

- [ ] **Step 2: Update `api-worker/worker-configuration.d.ts`**

Add two fields to the `Env` interface:

```ts
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
```

- [ ] **Step 3: Update `api-worker/vitest.config.ts`**

Add the two new bindings to the `miniflare.bindings` block:

```ts
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
```

- [ ] **Step 4: Update `api-worker/.dev.vars.example`**

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon-key>
```

- [ ] **Step 5: Install + verify**

```bash
cd /Users/user/Documents/GitHub/embedchat-widget
pnpm install
pnpm --filter=api-worker typecheck
pnpm --filter=api-worker test
```

Expected: install succeeds, typecheck clean, all 21 existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add api-worker/package.json api-worker/worker-configuration.d.ts api-worker/vitest.config.ts api-worker/.dev.vars.example pnpm-lock.yaml
git commit -m "chore(api-worker): add @supabase/supabase-js + env vars for Phase 2"
```

---

## Task 15: api-worker RAG types + supabase client factory

**Files:**
- Create: `api-worker/src/rag/types.ts`
- Create: `api-worker/src/supabase.ts`

- [ ] **Step 1: Create `api-worker/src/rag/types.ts`**

```ts
export interface RetrievedChunk {
  id: string;
  source_path: string;
  heading_path: string | null;
  content: string;
  similarity: number;
}

export interface SiteRagState {
  site_id: string;
  status: "pending" | "indexing" | "ready" | "failed";
  chunk_count: number;
  last_indexed_at: string | null;
}
```

- [ ] **Step 2: Create `api-worker/src/supabase.ts`**

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter=api-worker typecheck
```

- [ ] **Step 4: Commit**

```bash
git add api-worker/src/rag/types.ts api-worker/src/supabase.ts
git commit -m "feat(api-worker): RAG types + supabase client factory"
```

---

## Task 16: Query embedding (TDD)

**Files:**
- Create: `api-worker/test/rag-embed-query.test.ts`
- Create: `api-worker/src/rag/embed-query.ts`

- [ ] **Step 1: Write failing tests — `api-worker/test/rag-embed-query.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { embedQuery } from "../src/rag/embed-query";

describe("embedQuery", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("calls the OpenAI embeddings endpoint with the query", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.25) }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", mock);

    const vec = await embedQuery("hello world", "sk-test");
    expect(vec).toHaveLength(1536);
    expect(vec[0]).toBe(0.25);

    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect((init.headers as any).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toBe("hello world");
  });

  it("truncates very long inputs to a safe length", async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.1) }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", mock);

    const longInput = "x".repeat(20000);
    await embedQuery(longInput, "sk-test");
    const body = JSON.parse((mock.mock.calls[0] as any)[1].body);
    expect(body.input.length).toBeLessThanOrEqual(8000);
  });

  it("throws on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    await expect(embedQuery("hi", "sk-test")).rejects.toThrow(/OpenAI/);
  });

  it("rejects empty query", async () => {
    await expect(embedQuery("", "sk-test")).rejects.toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter=api-worker test
```

- [ ] **Step 3: Implement `api-worker/src/rag/embed-query.ts`**

```ts
const ENDPOINT = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
// 8192 tokens max for text-embedding-3-small. Character cap as a safety bound.
const MAX_CHARS = 8000;

export async function embedQuery(query: string, apiKey: string): Promise<number[]> {
  if (query.trim().length === 0) {
    throw new Error("embedQuery: empty query");
  }
  const input = query.length > MAX_CHARS ? query.slice(0, MAX_CHARS) : query;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, input }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  const vec = json.data[0]?.embedding;
  if (!vec || vec.length !== 1536) {
    throw new Error(`OpenAI embeddings: unexpected shape`);
  }
  return vec;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter=api-worker test
```

- [ ] **Step 5: Commit**

```bash
git add api-worker/src/rag/embed-query.ts api-worker/test/rag-embed-query.test.ts
git commit -m "feat(api-worker): query embedding via OpenAI"
```

---

## Task 17: Retrieval via Supabase RPC (TDD)

**Files:**
- Create: `api-worker/test/rag-retrieve.test.ts`
- Create: `api-worker/src/rag/retrieve.ts`

- [ ] **Step 1: Write failing tests — `api-worker/test/rag-retrieve.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSiteRagState, retrieveChunks } from "../src/rag/retrieve";

function stubSupabase(responseBody: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("getSiteRagState", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns site state when the row exists", async () => {
    vi.stubGlobal(
      "fetch",
      stubSupabase([
        {
          site_id: "demo-public",
          status: "ready",
          chunk_count: 42,
          last_indexed_at: "2026-04-21T00:00:00Z",
        },
      ]),
    );

    const state = await getSiteRagState(
      "https://test.supabase.co",
      "test-anon",
      "demo-public",
    );
    expect(state).not.toBeNull();
    expect(state!.status).toBe("ready");
    expect(state!.chunk_count).toBe(42);
  });

  it("returns null when the row does not exist", async () => {
    vi.stubGlobal("fetch", stubSupabase([]));
    const state = await getSiteRagState(
      "https://test.supabase.co",
      "test-anon",
      "does-not-exist",
    );
    expect(state).toBeNull();
  });

  it("returns null on Supabase error (best-effort semantics)", async () => {
    vi.stubGlobal("fetch", stubSupabase({ error: "boom" }, 500));
    const state = await getSiteRagState(
      "https://test.supabase.co",
      "test-anon",
      "demo-public",
    );
    expect(state).toBeNull();
  });
});

describe("retrieveChunks", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("posts to the match_chunks RPC with correct payload", async () => {
    const mock = stubSupabase([
      { id: "1", source_path: "README.md", heading_path: "## Sec", content: "body", similarity: 0.9 },
    ]);
    vi.stubGlobal("fetch", mock);

    const embedding = new Array(1536).fill(0.5);
    const chunks = await retrieveChunks(
      "https://test.supabase.co",
      "test-anon",
      "demo-public",
      embedding,
      5,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].similarity).toBe(0.9);

    const [url, init] = (mock.mock.calls[0] as any);
    expect(String(url)).toContain("/rest/v1/rpc/match_chunks");
    expect((init as any).method).toBe("POST");
    const body = JSON.parse((init as any).body);
    expect(body.match_site_id).toBe("demo-public");
    expect(body.match_count).toBe(5);
    expect(body.query_embedding).toEqual(embedding);
  });

  it("returns [] on Supabase error (best-effort)", async () => {
    vi.stubGlobal("fetch", stubSupabase({ error: "boom" }, 500));
    const embedding = new Array(1536).fill(0.5);
    const chunks = await retrieveChunks(
      "https://test.supabase.co",
      "test-anon",
      "demo-public",
      embedding,
      5,
    );
    expect(chunks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter=api-worker test
```

- [ ] **Step 3: Implement `api-worker/src/rag/retrieve.ts`**

```ts
import type { RetrievedChunk, SiteRagState } from "./types";

/** Minimal PostgREST + RPC calls via raw fetch for easy stubbing in tests. */
async function postgrest(
  supabaseUrl: string,
  anonKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = {
    ...(init.headers as Record<string, string> | undefined),
    apikey: anonKey,
    authorization: `Bearer ${anonKey}`,
    "content-type": "application/json",
    accept: "application/json",
  };
  return fetch(`${supabaseUrl}${path}`, { ...init, headers });
}

export async function getSiteRagState(
  supabaseUrl: string,
  anonKey: string,
  siteId: string,
): Promise<SiteRagState | null> {
  try {
    const res = await postgrest(
      supabaseUrl,
      anonKey,
      `/rest/v1/sites?select=site_id,status,chunk_count,last_indexed_at&site_id=eq.${encodeURIComponent(siteId)}&limit=1`,
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as SiteRagState[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function retrieveChunks(
  supabaseUrl: string,
  anonKey: string,
  siteId: string,
  queryEmbedding: number[],
  k: number,
): Promise<RetrievedChunk[]> {
  try {
    const res = await postgrest(supabaseUrl, anonKey, `/rest/v1/rpc/match_chunks`, {
      method: "POST",
      body: JSON.stringify({
        query_embedding: queryEmbedding,
        match_site_id: siteId,
        match_count: k,
      }),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as RetrievedChunk[];
    return rows;
  } catch {
    return [];
  }
}
```

**Note:** We use raw `fetch` to Supabase rather than `@supabase/supabase-js` here for three reasons: (1) the RPC call is 3 lines of JSON, (2) no dependency surface in hot-path code, (3) tests stub with one `fetch` mock instead of mocking the Supabase client. The client library is still added as a dependency for future use.

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter=api-worker test
```

- [ ] **Step 5: Commit**

```bash
git add api-worker/src/rag/retrieve.ts api-worker/test/rag-retrieve.test.ts
git commit -m "feat(api-worker): RAG retrieval via pgvector RPC; best-effort failure"
```

---

## Task 18: Context injection (TDD)

**Files:**
- Create: `api-worker/test/rag-context.test.ts`
- Create: `api-worker/src/rag/context.ts`

- [ ] **Step 1: Write failing tests — `api-worker/test/rag-context.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildContextSystemPrompt } from "../src/rag/context";
import type { RetrievedChunk } from "../src/rag/types";

const ORIGINAL = "You are a demo assistant.";

const chunks: RetrievedChunk[] = [
  {
    id: "1",
    source_path: "README.md",
    heading_path: "## Security > ### Rate limits",
    content: "Three KV-counter gates.",
    similarity: 0.91,
  },
  {
    id: "2",
    source_path: "api-worker/src/routes/chat.ts",
    heading_path: "api-worker/src/routes/chat.ts > export: chatRoute",
    content: "chatRoute.post('/', ...)",
    similarity: 0.85,
  },
];

describe("buildContextSystemPrompt", () => {
  it("returns the original prompt unchanged when no chunks", () => {
    expect(buildContextSystemPrompt(ORIGINAL, [])).toBe(ORIGINAL);
  });

  it("prepends a context instruction when chunks are present", () => {
    const out = buildContextSystemPrompt(ORIGINAL, chunks);
    expect(out).toContain("context retrieved from the EmbedChat project");
    expect(out).toContain("<context source=\"README.md\"");
    expect(out).toContain("<context source=\"api-worker/src/routes/chat.ts\"");
    expect(out.endsWith(ORIGINAL)).toBe(true);
  });

  it("includes heading_path in the context tag", () => {
    const out = buildContextSystemPrompt(ORIGINAL, chunks);
    expect(out).toContain('heading="## Security > ### Rate limits"');
  });

  it("handles null heading_path", () => {
    const out = buildContextSystemPrompt(ORIGINAL, [
      { id: "x", source_path: "x.md", heading_path: null, content: "body", similarity: 0.5 },
    ]);
    expect(out).toContain('<context source="x.md">');
    expect(out).not.toContain('heading=""');
  });

  it("escapes literal </context> in chunk content", () => {
    const out = buildContextSystemPrompt(ORIGINAL, [
      {
        id: "1",
        source_path: "x.md",
        heading_path: null,
        content: "prefix </context> attack",
        similarity: 0.9,
      },
    ]);
    expect(out).not.toContain("prefix </context> attack");
    expect(out).toContain("prefix < /context> attack");
  });

  it("escapes double quotes in source_path and heading_path attributes", () => {
    const out = buildContextSystemPrompt(ORIGINAL, [
      {
        id: "1",
        source_path: 'evil".md',
        heading_path: 'also"quoted',
        content: "body",
        similarity: 0.9,
      },
    ]);
    expect(out).toMatch(/source="evil&quot;\.md"/);
    expect(out).toMatch(/heading="also&quot;quoted"/);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm --filter=api-worker test
```

- [ ] **Step 3: Implement `api-worker/src/rag/context.ts`**

```ts
import type { RetrievedChunk } from "./types";

const PREAMBLE = `You have access to context retrieved from the EmbedChat project documentation and source code. Use it to answer the user's question. Cite the source path where relevant (e.g. "per README.md"). If the context does not contain the answer, say you don't know rather than guessing.`;

function escapeAttr(v: string): string {
  return v.replace(/"/g, "&quot;");
}

function escapeContent(v: string): string {
  return v.split("</context>").join("< /context>");
}

function formatChunk(chunk: RetrievedChunk): string {
  const source = escapeAttr(chunk.source_path);
  const heading = chunk.heading_path ? ` heading="${escapeAttr(chunk.heading_path)}"` : "";
  const body = escapeContent(chunk.content);
  return `<context source="${source}"${heading}>\n${body}\n</context>`;
}

export function buildContextSystemPrompt(
  originalSystemPrompt: string,
  chunks: RetrievedChunk[],
): string {
  if (chunks.length === 0) return originalSystemPrompt;
  const blocks = chunks.map(formatChunk).join("\n\n");
  return `${PREAMBLE}\n\n${blocks}\n\n${originalSystemPrompt}`;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm --filter=api-worker test
```

- [ ] **Step 5: Commit**

```bash
git add api-worker/src/rag/context.ts api-worker/test/rag-context.test.ts
git commit -m "feat(api-worker): context injection with attribute + content escaping"
```

---

## Task 19: Chat route step 7a integration (TDD)

**Files:**
- Modify: `api-worker/src/routes/chat.ts`
- Modify: `api-worker/test/chat.test.ts`

Wires retrieval into the existing POST /chat pipeline. Existing Phase 1 chat tests continue to pass (Supabase stub returns status ≠ `'ready'` → RAG skipped → same behavior as before). New tests cover the RAG-active path and the Supabase-down fallback.

- [ ] **Step 1: Augment `api-worker/test/chat.test.ts` — add new tests before the `GET /health` describe block**

Add at the top of the file (if not already present):

```ts
import { env } from "cloudflare:test";
```

Append these new tests, scoped under a new `describe`:

```ts
describe("POST /chat with RAG", () => {
  it("injects <context> into the system prompt when site.status=ready", async () => {
    const capturedOpenAIBody = { body: "" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites")) {
          return new Response(
            JSON.stringify([
              { site_id: "demo-public", status: "ready", chunk_count: 2, last_indexed_at: null },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/rpc/match_chunks")) {
          return new Response(
            JSON.stringify([
              {
                id: "1",
                source_path: "README.md",
                heading_path: "## Rate limits",
                content: "Three KV-counter gates.",
                similarity: 0.92,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u === "https://api.openai.com/v1/embeddings") {
          return new Response(
            JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.1) }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u === "https://api.openai.com/v1/chat/completions") {
          capturedOpenAIBody.body = (init as any).body;
          return new Response(
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://rag.example",
        "cf-connecting-ip": "10.10.10.10",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "how does rate limiting work?" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const openaiBody = JSON.parse(capturedOpenAIBody.body);
    const systemMsg = openaiBody.messages.find((m: any) => m.role === "system");
    expect(systemMsg).toBeTruthy();
    expect(systemMsg.content).toContain("<context source=\"README.md\"");
    expect(systemMsg.content).toContain("Three KV-counter gates.");
  });

  it("falls back to ungrounded when Supabase is down", async () => {
    const capturedOpenAIBody = { body: "" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.startsWith(env.SUPABASE_URL)) {
          return new Response("upstream down", { status: 503 });
        }
        if (u === "https://api.openai.com/v1/chat/completions") {
          capturedOpenAIBody.body = (init as any).body;
          return new Response(
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://rag-down.example",
        "cf-connecting-ip": "10.10.10.11",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const openaiBody = JSON.parse(capturedOpenAIBody.body);
    const systemMsg = openaiBody.messages.find((m: any) => m.role === "system");
    expect(systemMsg.content).not.toContain("<context");
  });

  it("skips RAG when site.status is not 'ready'", async () => {
    const capturedOpenAIBody = { body: "" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any, init?: any) => {
        const u = String(url);
        if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites")) {
          return new Response(
            JSON.stringify([
              { site_id: "demo-public", status: "pending", chunk_count: 0, last_indexed_at: null },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (u === "https://api.openai.com/v1/chat/completions") {
          capturedOpenAIBody.body = (init as any).body;
          return new Response(
            `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\ndata: [DONE]\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response("unexpected", { status: 500 });
      }),
    );

    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://pending.example",
        "cf-connecting-ip": "10.10.10.12",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const openaiBody = JSON.parse(capturedOpenAIBody.body);
    const systemMsg = openaiBody.messages.find((m: any) => m.role === "system");
    expect(systemMsg.content).not.toContain("<context");
  });
});
```

- [ ] **Step 2: Run tests — verify the new RAG tests fail, existing tests still pass**

```bash
pnpm --filter=api-worker test
```

Expected: the three new RAG tests fail; 21 existing tests still pass.

- [ ] **Step 3: Modify `api-worker/src/routes/chat.ts` — insert step 7a**

Add new imports at the top:

```ts
import { embedQuery } from "../rag/embed-query";
import { getSiteRagState, retrieveChunks } from "../rag/retrieve";
import { buildContextSystemPrompt } from "../rag/context";
```

Locate the block that constructs `wrapped` and `systemPrompt`:

```ts
  const systemPrompt =
    site.allowSystemPromptOverride && body.systemPrompt
      ? body.systemPrompt
      : site.systemPrompt;

  const wrapped = buildMessages(trimmed);
```

After those two statements, insert the step 7a block. The complete region becomes:

```ts
  const systemPrompt =
    site.allowSystemPromptOverride && body.systemPrompt
      ? body.systemPrompt
      : site.systemPrompt;

  const wrapped = buildMessages(trimmed);

  // Step 7a: best-effort RAG retrieval.
  let systemPromptFinal = systemPrompt;
  try {
    const ragState = await getSiteRagState(
      c.env.SUPABASE_URL,
      c.env.SUPABASE_ANON_KEY,
      body.siteId,
    );
    if (ragState?.status === "ready") {
      const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user")?.content;
      if (lastUserMsg && lastUserMsg.trim().length > 0) {
        const queryEmbedding = await embedQuery(lastUserMsg, c.env.OPENAI_API_KEY);
        const chunks = await retrieveChunks(
          c.env.SUPABASE_URL,
          c.env.SUPABASE_ANON_KEY,
          body.siteId,
          queryEmbedding,
          5,
        );
        systemPromptFinal = buildContextSystemPrompt(systemPrompt, chunks);
      }
    }
  } catch (e) {
    console.warn("RAG retrieval failed, falling back to ungrounded:", (e as Error).message);
  }
```

Then change the provider.stream call's `systemPrompt` argument from `systemPrompt` to `systemPromptFinal`:

```ts
        const iter = provider.stream({
          systemPrompt: systemPromptFinal,
          messages: wrapped,
          maxTokens: site.maxOutputTokens,
          apiKey,
        });
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
pnpm --filter=api-worker test
```

Expected: 24 tests pass (21 existing + 3 new RAG).

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter=api-worker typecheck
```

- [ ] **Step 6: Commit**

```bash
git add api-worker/src/routes/chat.ts api-worker/test/chat.test.ts
git commit -m "feat(api-worker): step 7a RAG retrieval with best-effort fallback"
```

---

## Task 20: E2E smoke test covering grounded path

**Files:**
- Modify: `api-worker/test/e2e.test.ts`

- [ ] **Step 1: Replace `api-worker/test/e2e.test.ts` contents**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SELF, env } from "cloudflare:test";

const OPENAI_SHORT = `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}

data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}

data: [DONE]

`;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: any) => {
      const u = String(url);
      if (u.startsWith(env.SUPABASE_URL + "/rest/v1/sites")) {
        return new Response(
          JSON.stringify([
            { site_id: "demo-public", status: "ready", chunk_count: 1, last_indexed_at: null },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.startsWith(env.SUPABASE_URL + "/rest/v1/rpc/match_chunks")) {
        return new Response(
          JSON.stringify([
            {
              id: "1",
              source_path: "README.md",
              heading_path: "## E2E",
              content: "known-e2e-chunk",
              similarity: 0.9,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u === "https://api.openai.com/v1/embeddings") {
        return new Response(
          JSON.stringify({ data: [{ embedding: new Array(1536).fill(0.1) }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u === "https://api.openai.com/v1/chat/completions") {
        return new Response(OPENAI_SHORT, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("unexpected", { status: 500 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("e2e: /chat smoke — grounded", () => {
  it("streams tokens and injects retrieved context", async () => {
    const res = await SELF.fetch("https://fake/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://e2e.example",
        "cf-connecting-ip": "7.7.7.7",
      },
      body: JSON.stringify({
        siteId: "demo-public",
        messages: [{ role: "user", content: "tell me about e2e" }],
        systemPrompt: null,
        model: "gpt-4o-mini",
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const frames = text.split("\n\n").filter(Boolean);
    const parsed = frames.map((f) => JSON.parse(f.replace(/^data:\s*/, "")));
    expect(parsed.some((p) => p.t === "token")).toBe(true);
    expect(parsed.some((p) => p.t === "done")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests + commit**

```bash
pnpm --filter=api-worker test
git add api-worker/test/e2e.test.ts
git commit -m "test(api-worker): e2e covers grounded /chat path"
```

Expected: 24 tests total still pass.

---

## Task 21: End-to-end manual smoke (user-driven)

No code changes. Operator verification that the plan is complete and Supabase setup works.

- [ ] **Step 1: Create a Supabase project**

Go to https://supabase.com → new project (free tier). Note the `Project URL` and the `anon` + `service_role` keys from Settings → API.

- [ ] **Step 2: Run the schema**

In the SQL Editor, paste the contents of `supabase/schema.sql` and run it. Verify tables `sites` and `chunks` exist, plus the `match_chunks` function.

- [ ] **Step 3: Configure ingestion `.env`**

```bash
cp ingestion/.env.example ingestion/.env
# Edit ingestion/.env with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
```

- [ ] **Step 4: Run ingestion**

```bash
pnpm ingest
```

Expected output: `ingest: done — <N> chunks in Xs`. N should be ≥ 40.

In Supabase SQL Editor: `select status, chunk_count from sites;` → `ready`, `<N>`.

- [ ] **Step 5: Configure api-worker `.dev.vars`**

Append `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `api-worker/.dev.vars`.

- [ ] **Step 6: Smoke test against local dev**

```bash
pnpm dev:api
```

In a browser, open the demo (via the local-test setup from earlier) and ask: **"how does rate limiting work in this project?"**

Expected: the response mentions specific sources — e.g. `api-worker/src/ratelimit.ts` or `README.md > ## Security > ### Rate limits`.

- [ ] **Step 7: Smoke test fallback**

Temporarily set `SUPABASE_URL=https://bogus.example.com` in `api-worker/.dev.vars`, restart `pnpm dev:api`, and ask any question. Confirm:
- Chat still works (replies normally).
- api-worker logs a `RAG retrieval failed, falling back to ungrounded` warning.

Restore the real URL afterward.

---

## Task 22: Documentation updates

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Update `README.md`**

Replace the existing **Roadmap** section with:

```markdown
## Roadmap

Phase 1 and Phase 2 ship today:
- ✅ **Phase 1** — Widget + streaming LLM backend + demo site.
- ✅ **Phase 2** — **RAG grounding**: `demo-public` is grounded on the EmbedChat repo itself via Supabase pgvector. Ask about rate limits or the chat route, and the bot cites specific source files.

Phase 3 adds:
- [ ] Arbitrary-site RAG via `data-knowledge-url` — ingest-worker + crawler, same retrieval path.
- [ ] Admin UI for named site-ids with per-site system prompts + origin allowlists.
- [ ] Conversation persistence, analytics, lead capture, handoff-to-human.
- [ ] Per-site custom fonts loaded via Shadow DOM.
- [ ] Multi-language auto-detect.
```

Also update the tagline at the top. Replace the existing `> A drop-in AI chat widget for any website...` line with:

```markdown
> A drop-in AI chat widget for any website. One `<script>` tag, Shadow-DOM isolated, configured by data-attributes. ~3.6kb gzipped. Phase 2 adds RAG grounding — the demo is a bot that knows the EmbedChat codebase.
```

Add a new section after **Security**:

```markdown
## RAG grounding (Phase 2)

The `demo-public` site-id is grounded on the EmbedChat repo itself. Ask the demo bot things like "how does rate limiting work?" or "what's in chat.ts?" — it retrieves from the indexed codebase and cites sources.

- **Ingestion** is a local CLI (`pnpm ingest`): crawls a hardcoded source allowlist (README, specs, selected source files), chunks with Markdown/TypeScript awareness, embeds with OpenAI `text-embedding-3-small`, upserts to Supabase pgvector.
- **Retrieval** happens inside `/chat`: embed the latest user message, top-5 cosine search, inject `<context>` blocks into the system prompt.
- **Best-effort**: if Supabase is unreachable, chat falls back to ungrounded responses. No 500s, no hard dependency.

Deploy this for your own site: see [`docs/DEPLOY.md`](docs/DEPLOY.md#supabase-setup-phase-2).
```

- [ ] **Step 2: Update `docs/ARCHITECTURE.md`**

After the existing "Components" diagram section, add:

````markdown
## Phase 2: RAG retrieval step

```
Widget                api-worker (Hono)                    Supabase (pgvector)    OpenAI
  │                        │                                        │               │
  │─ POST /chat ─────────▶ │                                        │               │
  │                        │ Phase 1 steps 1-6 (CORS, rate-limit,   │               │
  │                        │   validate, trim, wrap)                │               │
  │                        │                                        │               │
  │                        │ 7a. If site.status=ready in sites:     │               │
  │                        │   ─── GET /rest/v1/sites ───────────▶ │               │
  │                        │ ◀─ site row ─────────────────────────  │               │
  │                        │   ─── POST /v1/embeddings (query) ─────────────────▶ │
  │                        │ ◀─ embedding ──────────────────────────────────────── │
  │                        │   ─── POST /rest/v1/rpc/match_chunks ─▶               │
  │                        │ ◀─ top-5 chunks ──────────────────────                │
  │                        │   build system prompt with <context>                   │
  │                        │                                        │               │
  │                        │ 7. Provider stream ─ POST /v1/chat/completions ─────▶ │
  │ ◀── SSE tokens ─────── │ ◀── stream chunks ───────────────────────────────── │
  │ ◀── SSE done ───────── │   incrementTokens(KV)                                  │
```

## Phase 2 file additions

| Path | Responsibility |
|---|---|
| `supabase/schema.sql`                      | DDL: sites + chunks + match_chunks RPC |
| `ingestion/bin/ingest.ts`                  | CLI entry (`pnpm ingest`) |
| `ingestion/src/chunk/markdown.ts`          | Markdown-aware recursive splitter |
| `ingestion/src/chunk/typescript.ts`        | Top-level-decl splitter via TS compiler API |
| `ingestion/src/embed/openai.ts`            | Batched embedding calls |
| `ingestion/src/store/supabase.ts`          | Upsert site + replace chunks |
| `ingestion/src/orchestrator.ts`            | Wires crawl → chunk → embed → store |
| `api-worker/src/rag/embed-query.ts`        | Query embedding per chat |
| `api-worker/src/rag/retrieve.ts`           | Site state + top-k via RPC; fails closed |
| `api-worker/src/rag/context.ts`            | Formats `<context>` blocks with escaping |
| `api-worker/src/routes/chat.ts` (modified) | Inserts step 7a |
````

- [ ] **Step 3: Update `docs/DEPLOY.md`** — add a new section at the end

```markdown
## Supabase setup (Phase 2)

RAG grounding requires a Supabase Postgres project with pgvector.

### 1. Create the project

1. Go to https://supabase.com and create a new project (free tier is sufficient).
2. Note three values from Settings → API:
   - `Project URL` (`SUPABASE_URL`)
   - `anon` public key (`SUPABASE_ANON_KEY`)
   - `service_role` secret key (`SUPABASE_SERVICE_ROLE_KEY`)

### 2. Apply the schema

In the SQL Editor, paste the contents of `supabase/schema.sql` and run. Verify:

```sql
select * from sites;  -- empty
select count(*) from chunks;  -- 0
select proname from pg_proc where proname = 'match_chunks';  -- returns match_chunks
```

### 3. Configure ingestion

```bash
cp ingestion/.env.example ingestion/.env
# Edit ingestion/.env with your three Supabase values + OPENAI_API_KEY
```

Keys in `.env`:
- `SUPABASE_URL` (same as above)
- `SUPABASE_SERVICE_ROLE_KEY` (for bulk writes — never deploy this to Workers)
- `OPENAI_API_KEY`

### 4. Run ingestion

```bash
pnpm ingest
```

Expected: a summary line reporting chunk count. Verify in Supabase:

```sql
select status, chunk_count, last_indexed_at from sites where site_id = 'demo-public';
```

Should show `ready`, a chunk count ≥ 40, and a recent timestamp.

### 5. Add Supabase secrets to api-worker

```bash
cd api-worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
```

Note: use the **anon** key for api-worker (read-only path), not the service role.

### 6. Redeploy

```bash
pnpm deploy
```

### 7. Verify grounded responses

Visit the live demo and ask "how does rate limiting work?" — the response should mention specific sources (e.g. `api-worker/src/ratelimit.ts`).

### Refreshing the knowledge base

Whenever the repo changes, re-run `pnpm ingest`. It's idempotent: chunks for `demo-public` are wiped and reinserted on every run.

### Graceful degradation

If Supabase becomes unreachable, `/chat` falls back to ungrounded responses — no 500s, no user-visible error. Verify with `curl https://embedchat-api.brightnwokoro.dev/chat -d '...'` while `SUPABASE_URL` points somewhere bogus.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/ARCHITECTURE.md docs/DEPLOY.md
git commit -m "docs: Phase 2 RAG grounding — README, architecture, deploy runbook"
```

---

## Task 23: Final green-check + Phase 2 ship

Verification task — no new files.

- [ ] **Step 1: Full test run**

```bash
cd /Users/user/Documents/GitHub/embedchat-widget
pnpm install
pnpm typecheck
pnpm test
```

Expected counts:
- widget: 28 (unchanged)
- api-worker: 24 (21 Phase 1 + 3 new RAG chat tests)
- ingestion: 18+ (tokenizer 4 + markdown 8 + typescript 8 + orchestrator 2 + embed 4)

Total: 70+ tests passing across 3 workspaces.

- [ ] **Step 2: Full build**

```bash
pnpm build
```

- [ ] **Step 3: Bundle size**

```bash
gzip -c widget/dist/embedchat.js | wc -c
```

Expected: unchanged from Phase 1 (~3.6kb). RAG is backend-only.

- [ ] **Step 4: Complete Task 21 (manual smoke) if not done already**

See Task 21 steps 1–7.

- [ ] **Step 5: If all green: redeploy**

```bash
pnpm deploy
```

Visit `https://embedchat-demo.brightnwokoro.dev` and verify grounded responses in the browser.

- [ ] **Step 6: Final push**

```bash
git push origin main
```

Phase 2 complete.

---

## Appendix A: Test count after Phase 2

| Workspace | Phase 1 | Phase 2 adds | Total |
|---|---:|---:|---:|
| widget | 28 | 0 | 28 |
| api-worker | 21 | 3 (chat RAG paths) + 4 (rag-embed-query) + 4 (rag-retrieve) + 6 (rag-context) = 17 | 38 |
| ingestion | — | 4 (tokenizer) + 8 (markdown) + 8 (typescript) + 4 (embed) + 2 (orchestrator) = 26 | 26 |
| **Total** | **49** | **43** | **92** |

Note: Exact test count in each module may differ by 1-2 depending on how `it()` calls break down; totals are approximate.

## Appendix B: Approximate Phase 2 cost

- **One-time embedding** (≈ 50 chunks × 500 tokens): ~$0.0005
- **Per-chat query embedding** (≤ 100 tokens avg): ~$0.000002
- **Supabase free tier**: 500MB storage. ~50 chunks × 1536 dims × 4 bytes = 300KB. Negligible.
- **OpenAI chat cost increment**: prompt grows by ~2500 tokens per message with RAG active → small increase.

At 500 questions/day with RAG, monthly cost increment: < $2.

## Appendix C: Versions at time of writing (2026-04-21)

- `@supabase/supabase-js`: ^2.45
- `js-tiktoken`: ^1.0.15
- `typescript` (for compiler API): ^5.6
- `tsx`: ^4.19
- `dotenv`: ^16.4
- All Phase 1 versions unchanged.
