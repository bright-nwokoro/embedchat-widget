import { Hono } from "hono";
import type { Env } from "../../worker-configuration";

export const healthRoute = new Hono<{ Bindings: Env }>();

healthRoute.get("/", (c) => {
  return c.json({
    ok: true,
    providers: {
      openai: c.env.OPENAI_API_KEY ? "configured" : "missing",
      anthropic: c.env.ANTHROPIC_API_KEY ? "configured" : "missing",
    },
    version: "0.1.0",
  });
});
