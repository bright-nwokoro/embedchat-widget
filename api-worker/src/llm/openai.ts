import type { LLMProvider, StreamParams } from "./provider";
import type { StreamChunk } from "../types";

export function createOpenAIProvider(modelId: string): LLMProvider {
  return {
    async *stream(params: StreamParams): AsyncIterable<StreamChunk> {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: modelId,
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: params.maxTokens,
          messages: [
            { role: "system", content: params.systemPrompt },
            ...params.messages,
          ],
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let usage: StreamChunk["usage"];

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
            if (!raw || raw === "[DONE]") continue;
            try {
              const obj = JSON.parse(raw);
              const delta: string | undefined = obj?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                yield { delta, done: false };
              }
              if (obj?.usage) {
                usage = {
                  inputTokens: obj.usage.prompt_tokens ?? 0,
                  outputTokens: obj.usage.completion_tokens ?? 0,
                };
              }
            } catch {
              /* skip malformed */
            }
          }
        }
      }

      yield { delta: "", done: true, ...(usage !== undefined && { usage }) };
    },
  };
}
