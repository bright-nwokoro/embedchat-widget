import type { Message, ModelId, StreamEvent } from "./types";

export interface ChatRequest {
  siteId: string;
  messages: Message[];
  systemPrompt: string | null;
  model: ModelId;
}

export interface StreamChatParams {
  apiUrl: string;
  body: ChatRequest;
  signal?: AbortSignal;
}

export async function* streamChat(
  params: StreamChatParams,
): AsyncIterable<StreamEvent> {
  let res: Response;
  try {
    res = await fetch(`${params.apiUrl.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params.body),
      ...(params.signal && { signal: params.signal }),
    });
  } catch (e) {
    yield { type: "error", message: `Request failed: ${(e as Error).message}` };
    return;
  }

  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      /* ignore */
    }
    yield {
      type: "error",
      message: `Server responded ${res.status}${bodyText ? `: ${bodyText}` : ""}`,
    };
    return;
  }

  if (!res.body) {
    yield { type: "error", message: "Empty response body" };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseFrame(frame);
        if (ev) yield ev;
      }
    }
    if (buffer.trim()) {
      const ev = parseFrame(buffer);
      if (ev) yield ev;
    }
  } catch (e) {
    yield { type: "error", message: `Stream read failed: ${(e as Error).message}` };
  }
}

function parseFrame(frame: string): StreamEvent | null {
  for (const line of frame.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.t === "string") {
        if (obj.t === "token" && typeof obj.v === "string") {
          return { type: "token", value: obj.v };
        }
        if (obj.t === "done") {
          return { type: "done", usage: obj.usage };
        }
        if (obj.t === "error" && typeof obj.message === "string") {
          return { type: "error", message: obj.message };
        }
      }
    } catch {
      /* malformed — skip */
    }
  }
  return null;
}
