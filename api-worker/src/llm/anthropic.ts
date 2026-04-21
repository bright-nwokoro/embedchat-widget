import type { LLMProvider, StreamParams } from "./provider";
import type { StreamChunk } from "../types";

export function createAnthropicProvider(modelId: string): LLMProvider {
  return {
    async *stream(params: StreamParams): AsyncIterable<StreamChunk> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": params.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelId,
          stream: true,
          max_tokens: params.maxTokens,
          system: params.systemPrompt,
          messages: params.messages,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const obj = JSON.parse(raw);
              if (obj.type === "message_start") {
                inputTokens = obj.message?.usage?.input_tokens ?? inputTokens;
              } else if (obj.type === "content_block_delta") {
                const text: string | undefined = obj.delta?.text;
                if (typeof text === "string" && text.length > 0) {
                  yield { delta: text, done: false };
                }
              } else if (obj.type === "message_delta") {
                outputTokens = obj.usage?.output_tokens ?? outputTokens;
              }
            } catch {
              /* skip malformed */
            }
          }
        }
      }

      yield {
        delta: "",
        done: true,
        usage: { inputTokens, outputTokens },
      };
    },
  };
}
