import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../../worker-configuration";

export const adminRoute = new Hono<{ Bindings: Env }>();

/** Constant-time string compare to resist timing attacks on the admin bearer. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

const adminAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expected = c.env.ADMIN_API_KEY;
  if (!provided || !expected || !timingSafeEqual(provided, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};

adminRoute.use("*", adminAuth);

adminRoute.get("/ping", (c) => c.json({ ok: true }));
