import type { Env } from "../worker-configuration";

export default {
  async fetch(_req: Request, _env: Env): Promise<Response> {
    return new Response("not implemented", { status: 501 });
  },
};
