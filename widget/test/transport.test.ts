import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamChat } from "../src/transport";
import type { StreamEvent } from "../src/types";

function makeResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream", ...headers },
  });
}

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe("streamChat", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses token + done frames", async () => {
    const sse = [
      'data: {"t":"token","v":"Hel"}',
      "",
      'data: {"t":"token","v":"lo"}',
      "",
      'data: {"t":"done"}',
      "",
      "",
    ].join("\n");
    (globalThis.fetch as any).mockResolvedValue(makeResponse(sse));
    const events = await collect(
      streamChat({ apiUrl: "https://api.example", body: {} as any }),
    );
    expect(events).toEqual([
      { type: "token", value: "Hel" },
      { type: "token", value: "lo" },
      { type: "done" },
    ]);
  });

  it("parses error frame", async () => {
    const sse = ['data: {"t":"error","message":"limit"}', "", ""].join("\n");
    (globalThis.fetch as any).mockResolvedValue(makeResponse(sse));
    const events = await collect(
      streamChat({ apiUrl: "https://api.example", body: {} as any }),
    );
    expect(events).toEqual([{ type: "error", message: "limit" }]);
  });

  it("yields error on non-2xx response", async () => {
    (globalThis.fetch as any).mockResolvedValue(
      new Response('{"error":"bad"}', { status: 429 }),
    );
    const events = await collect(
      streamChat({ apiUrl: "https://api.example", body: {} as any }),
    );
    expect(events).toEqual([{ type: "error", message: expect.stringContaining("429") }]);
  });

  it("ignores malformed frames without crashing", async () => {
    const sse = [
      "data: not-json",
      "",
      'data: {"t":"token","v":"ok"}',
      "",
      'data: {"t":"done"}',
      "",
      "",
    ].join("\n");
    (globalThis.fetch as any).mockResolvedValue(makeResponse(sse));
    const events = await collect(
      streamChat({ apiUrl: "https://api.example", body: {} as any }),
    );
    expect(events).toContainEqual({ type: "token", value: "ok" });
    expect(events).toContainEqual({ type: "done" });
  });

  it("handles frames split across chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"t":"tok'));
        controller.enqueue(encoder.encode('en","v":"Hi"}\n\n'));
        controller.enqueue(encoder.encode('data: {"t":"done"}\n\n'));
        controller.close();
      },
    });
    (globalThis.fetch as any).mockResolvedValue(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const events = await collect(
      streamChat({ apiUrl: "https://api.example", body: {} as any }),
    );
    expect(events).toEqual([{ type: "token", value: "Hi" }, { type: "done" }]);
  });
});
