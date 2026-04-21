import { Hono } from "hono";
import type { Env } from "../../worker-configuration";
import { getSite } from "../sites";
import { buildMessages } from "../prompt";
import {
  checkIpLimit,
  checkOriginLimit,
  checkTokenBudget,
  incrementTokens,
  LIMITS,
} from "../ratelimit";
import type { ChatRequest, PublicModelId } from "../types";
import { MODEL_MAP } from "../llm/provider";
import { createOpenAIProvider } from "../llm/openai";
import { createAnthropicProvider } from "../llm/anthropic";

export const chatRoute = new Hono<{ Bindings: Env }>();

const VALID_MODELS: PublicModelId[] = ["gpt-4o-mini", "claude-haiku"];
const SITE_ID_RE = /^[a-z0-9-]{3,32}$/;

function corsHeaders(
  originHeader: string | null,
  site: { allowedOrigins: string[] | "*" },
): Record<string, string> {
  if (site.allowedOrigins === "*") {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    };
  }
  if (originHeader && site.allowedOrigins.includes(originHeader)) {
    return {
      "access-control-allow-origin": originHeader,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      vary: "Origin",
    };
  }
  return {};
}

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

// Phase-1 simplification: OPTIONS preflight unconditionally returns `*`.
// This is correct for demo-public (the only active site-id). Phase 3 adds
// named site-ids with origin allowlists; that will require the client to
// pass siteId in a way visible to preflight (e.g. path-based /chat/:siteId
// or a custom header), and this handler to then call corsHeaders(origin, site)
// the way the POST handler does.
chatRoute.options("/", () => {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });
});

chatRoute.post("/", async (c) => {
  let body: ChatRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid-json" }, 400);
  }

  if (typeof body.siteId !== "string" || !SITE_ID_RE.test(body.siteId)) {
    return c.json({ error: "invalid-siteId" }, 400);
  }

  const site = getSite(body.siteId);
  if (!site) {
    return c.json({ error: "unknown-site" }, 404);
  }

  const origin = c.req.header("origin") ?? "";
  const headers = corsHeaders(origin, site);
  if (site.allowedOrigins !== "*" && !headers["access-control-allow-origin"]) {
    return c.json({ error: "origin-not-allowed" }, 403);
  }

  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const originHost = (() => {
    try {
      return new URL(origin).hostname || "unknown";
    } catch {
      return "unknown";
    }
  })();

  const ipOk = await checkIpLimit(c.env.RATE_LIMIT, ip);
  if (!ipOk) return c.json({ error: "rate-limited-ip" }, 429, headers);

  const originOk = await checkOriginLimit(c.env.RATE_LIMIT, originHost);
  if (!originOk) return c.json({ error: "rate-limited-origin" }, 429, headers);

  const budgetOk = await checkTokenBudget(
    c.env.RATE_LIMIT,
    LIMITS.DAILY_TOKEN_BUDGET,
  );
  if (!budgetOk) {
    return c.json({ error: "daily-demo-limit", retryAfterHours: 24 }, 429, headers);
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "invalid-messages" }, 400, headers);
  }
  if (body.messages.length > 20) {
    return c.json({ error: "too-many-messages" }, 400, headers);
  }
  for (const m of body.messages) {
    if (m.role !== "user" && m.role !== "assistant") {
      return c.json({ error: "invalid-role" }, 400, headers);
    }
    if (typeof m.content !== "string") {
      return c.json({ error: "invalid-content" }, 400, headers);
    }
    if (m.content.length > site.maxMessageChars) {
      return c.json({ error: "message-too-long" }, 400, headers);
    }
  }
  if (!VALID_MODELS.includes(body.model)) {
    return c.json({ error: "invalid-model" }, 400, headers);
  }
  if (!site.allowedModels.includes(body.model)) {
    return c.json({ error: "model-not-allowed" }, 400, headers);
  }

  const trimmed = body.messages.slice(-site.maxHistoryTurns);

  const mapped = MODEL_MAP[body.model];
  const provider =
    mapped.provider === "openai"
      ? createOpenAIProvider(mapped.modelId)
      : createAnthropicProvider(mapped.modelId);
  const apiKey =
    mapped.provider === "openai" ? c.env.OPENAI_API_KEY : c.env.ANTHROPIC_API_KEY;

  const systemPrompt =
    site.allowSystemPromptOverride && body.systemPrompt
      ? body.systemPrompt
      : site.systemPrompt;

  const wrapped = buildMessages(trimmed);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const iter = provider.stream({
          systemPrompt,
          messages: wrapped,
          maxTokens: site.maxOutputTokens,
          apiKey,
        });
        for await (const chunk of iter) {
          if (chunk.delta) {
            controller.enqueue(
              encoder.encode(sseFrame({ t: "token", v: chunk.delta })),
            );
          }
          if (chunk.done) {
            const frame =
              chunk.usage !== undefined
                ? sseFrame({ t: "done", usage: chunk.usage })
                : sseFrame({ t: "done" });
            controller.enqueue(encoder.encode(frame));
            if (chunk.usage) {
              await incrementTokens(
                c.env.RATE_LIMIT,
                chunk.usage.inputTokens + chunk.usage.outputTokens,
              );
            }
          }
        }
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            sseFrame({ t: "error", message: (e as Error).message }),
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...headers,
    },
  });
});
