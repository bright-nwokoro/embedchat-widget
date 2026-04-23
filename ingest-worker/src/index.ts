import type { Env } from "../worker-configuration";
import type { IngestJob } from "./types";

export default {
  async queue(
    batch: MessageBatch<IngestJob>,
    _env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const msg of batch.messages) {
      console.log("ingest-worker: received job", msg.body.siteId);
      msg.ack();
    }
  },
};
