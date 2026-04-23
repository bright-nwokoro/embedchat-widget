import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { Env } from "../../worker-configuration";
import { enqueueIngest } from "../queue";

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

const SITE_ID_RE = /^[a-z0-9-]{3,32}$/;
const VALID_MODELS = ["gpt-4o-mini", "claude-haiku"] as const;
type PublicModelId = (typeof VALID_MODELS)[number];

interface PostSitesBody {
  siteId?: unknown;
  name?: unknown;
  knowledgeUrl?: unknown;
  systemPrompt?: unknown;
  allowedOrigins?: unknown;
  allowedModels?: unknown;
  defaultModel?: unknown;
}

async function preflightKnowledgeUrl(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "HEAD", redirect: "follow" });
  } catch {
    return { ok: false, reason: "knowledge-url-unreachable" };
  }
  if (!res.ok) return { ok: false, reason: "knowledge-url-unreachable" };
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const isXml = ct.includes("xml") || url.toLowerCase().endsWith(".xml");
  if (!isXml) return { ok: false, reason: "knowledge-url-not-xml" };
  return { ok: true };
}

adminRoute.post("/sites", async (c) => {
  let raw: PostSitesBody;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid-json" }, 400);
  }

  if (typeof raw.siteId !== "string" || !SITE_ID_RE.test(raw.siteId)) {
    return c.json({ error: "invalid-siteId" }, 400);
  }
  const siteId = raw.siteId;

  if (typeof raw.name !== "string" || raw.name.trim().length === 0 || raw.name.length > 100) {
    return c.json({ error: "invalid-name" }, 400);
  }

  if (typeof raw.knowledgeUrl !== "string" || !/^https?:\/\//.test(raw.knowledgeUrl)) {
    return c.json({ error: "invalid-knowledge-url" }, 400);
  }

  if (typeof raw.systemPrompt !== "string" || raw.systemPrompt.length > 4000) {
    return c.json({ error: "invalid-system-prompt" }, 400);
  }

  if (
    !Array.isArray(raw.allowedOrigins) ||
    raw.allowedOrigins.length === 0 ||
    !raw.allowedOrigins.every((o) => typeof o === "string")
  ) {
    return c.json({ error: "invalid-allowed-origins" }, 400);
  }
  for (const o of raw.allowedOrigins) {
    if (o !== "*" && !/^https?:\/\/[^/]+$/.test(o as string)) {
      return c.json({ error: "invalid-allowed-origins" }, 400);
    }
  }
  const allowedOrigins = raw.allowedOrigins as string[];

  const allowedModels = Array.isArray(raw.allowedModels)
    ? (raw.allowedModels as PublicModelId[]).filter((m) => VALID_MODELS.includes(m))
    : (["gpt-4o-mini", "claude-haiku"] as PublicModelId[]);
  if (allowedModels.length === 0) {
    return c.json({ error: "invalid-allowed-models" }, 400);
  }
  const defaultModel =
    typeof raw.defaultModel === "string" && VALID_MODELS.includes(raw.defaultModel as PublicModelId)
      ? (raw.defaultModel as PublicModelId)
      : allowedModels[0]!;

  const preflight = await preflightKnowledgeUrl(raw.knowledgeUrl);
  if (!preflight.ok) {
    return c.json({ error: preflight.reason }, 400);
  }

  const existsUrl = `${c.env.SUPABASE_URL}/rest/v1/sites?select=site_id&site_id=eq.${encodeURIComponent(siteId)}&limit=1`;
  const existsRes = await fetch(existsUrl, {
    method: "GET",
    headers: {
      apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (existsRes.ok) {
    const existing = (await existsRes.json()) as unknown[];
    if (existing.length > 0) {
      return c.json({ error: "site-exists" }, 409);
    }
  }

  const insertRes = await fetch(`${c.env.SUPABASE_URL}/rest/v1/sites`, {
    method: "POST",
    headers: {
      apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({
      site_id: siteId,
      name: raw.name,
      knowledge_source: raw.knowledgeUrl,
      status: "pending",
      allowed_origins: allowedOrigins,
      system_prompt: raw.systemPrompt,
      allow_system_prompt_override: false,
      allowed_models: allowedModels,
      default_model: defaultModel,
    }),
  });
  if (!insertRes.ok) {
    const errText = await insertRes.text().catch(() => "");
    return c.json({ error: "insert-failed", detail: errText.slice(0, 200) }, 500);
  }

  await enqueueIngest(c.env, { siteId, knowledgeUrl: raw.knowledgeUrl });

  return c.json({ siteId, status: "pending" }, 202);
});

adminRoute.get("/sites/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  if (!SITE_ID_RE.test(siteId)) {
    return c.json({ error: "invalid-siteId" }, 400);
  }
  const url =
    `${c.env.SUPABASE_URL}/rest/v1/sites` +
    `?select=site_id,name,knowledge_source,status,chunk_count,last_indexed_at,error_message` +
    `&site_id=eq.${encodeURIComponent(siteId)}&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    return c.json({ error: "upstream-failed" }, 502);
  }
  const rows = (await res.json()) as Array<{
    site_id: string;
    name: string | null;
    knowledge_source: string | null;
    status: string;
    chunk_count: number;
    last_indexed_at: string | null;
    error_message: string | null;
  }>;
  const row = rows[0];
  if (!row) return c.json({ error: "not-found" }, 404);
  return c.json({
    siteId: row.site_id,
    name: row.name,
    knowledgeUrl: row.knowledge_source,
    status: row.status,
    chunkCount: row.chunk_count,
    lastIndexedAt: row.last_indexed_at,
    errorMessage: row.error_message,
  });
});

adminRoute.post("/sites/:siteId/reingest", async (c) => {
  const siteId = c.req.param("siteId");
  if (!SITE_ID_RE.test(siteId)) return c.json({ error: "invalid-siteId" }, 400);

  const lookupRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/sites?select=site_id,knowledge_source&site_id=eq.${encodeURIComponent(siteId)}&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: "application/json",
      },
    },
  );
  if (!lookupRes.ok) return c.json({ error: "upstream-failed" }, 502);
  const rows = (await lookupRes.json()) as Array<{
    site_id: string;
    knowledge_source: string | null;
  }>;
  const row = rows[0];
  if (!row) return c.json({ error: "not-found" }, 404);
  if (!row.knowledge_source) return c.json({ error: "no-knowledge-url" }, 400);

  const patchRes = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/sites?site_id=eq.${encodeURIComponent(siteId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({ status: "pending", error_message: null }),
    },
  );
  if (!patchRes.ok) return c.json({ error: "upstream-failed" }, 502);

  await enqueueIngest(c.env, { siteId, knowledgeUrl: row.knowledge_source });
  return c.json({ siteId, status: "pending" }, 202);
});

adminRoute.delete("/sites/:siteId", async (c) => {
  const siteId = c.req.param("siteId");
  if (!SITE_ID_RE.test(siteId)) return c.json({ error: "invalid-siteId" }, 400);

  const res = await fetch(
    `${c.env.SUPABASE_URL}/rest/v1/sites?site_id=eq.${encodeURIComponent(siteId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: c.env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: "application/json",
        prefer: "return=representation",
      },
    },
  );
  if (!res.ok) return c.json({ error: "upstream-failed" }, 502);
  const deleted = (await res.json()) as unknown[];
  if (deleted.length === 0) return c.json({ error: "not-found" }, 404);
  return c.json({ ok: true });
});
