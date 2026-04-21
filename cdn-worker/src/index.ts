import { WIDGET_BUNDLE } from "./bundle";

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/embedchat.js") {
      return new Response(WIDGET_BUNDLE, {
        status: 200,
        headers: {
          "content-type": "application/javascript; charset=utf-8",
          "cache-control": "public, max-age=31536000, immutable",
          "access-control-allow-origin": "*",
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, size: WIDGET_BUNDLE.length });
    }
    return new Response("Not found", { status: 404 });
  },
};
