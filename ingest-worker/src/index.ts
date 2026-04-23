import type { Env } from "../worker-configuration";
import type { IngestJob } from "./types";
import { fetchSitemapUrls } from "./sitemap";
import { extractPage } from "./extract";
import { chunkPlainText, PlainTextChunk } from "./plaintext-chunker";
import { embedAll } from "./embed";
import { createServiceClient, markSiteStatus, replaceChunks } from "./supabase";

const DELAY_MS = 250;

// Any throw retries the entire job; partial progress is discarded. Acceptable for
// Phase 3a (≤200 pages per sitemap); revisit if per-page checkpointing becomes worthwhile.
async function processJob(env: Env, job: IngestJob): Promise<void> {
  const sb = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  await markSiteStatus(sb, job.siteId, { status: "indexing", error_message: null });

  const urls = await fetchSitemapUrls(job.knowledgeUrl);
  const chunks: PlainTextChunk[] = [];

  for (const url of urls) {
    const page = await extractPage(url);
    if (!page) continue;
    const pageChunks = chunkPlainText(page.text, {
      siteId: job.siteId,
      sourcePath: url,
      headingPath: page.title ?? url,
    });
    chunks.push(...pageChunks);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  if (chunks.length === 0) {
    throw new Error("ingest produced 0 chunks");
  }

  const vectors = await embedAll(chunks.map((c) => c.content), env.OPENAI_API_KEY);
  const withEmbeddings = chunks.map((c, i) => ({ ...c, embedding: vectors[i]! }));
  await replaceChunks(sb, job.siteId, withEmbeddings);

  await markSiteStatus(sb, job.siteId, {
    status: "ready",
    chunk_count: chunks.length,
    last_indexed_at: new Date().toISOString(),
  });
}

export default {
  async queue(batch: MessageBatch<IngestJob>, env: Env, _ctx: ExecutionContext): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processJob(env, msg.body);
        msg.ack();
      } catch (e) {
        const detail = (e as Error).message?.slice(0, 500) ?? "unknown";
        console.warn("ingest-worker failed:", msg.body.siteId, detail);
        try {
          const sb = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
          await markSiteStatus(sb, msg.body.siteId, {
            status: "failed",
            error_message: detail,
          });
        } catch {
          // if the status update fails, the retry still runs
        }
        msg.retry();
      }
    }
  },
};
