import type { Env } from "../worker-configuration";

export interface IngestJob {
  siteId: string;
  knowledgeUrl: string;
}

export async function enqueueIngest(env: Env, job: IngestJob): Promise<void> {
  await env.INGEST_QUEUE.send(job);
}
