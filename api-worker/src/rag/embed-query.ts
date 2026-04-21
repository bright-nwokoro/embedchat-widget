const ENDPOINT = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
// 8192 tokens max for text-embedding-3-small. Character cap as a safety bound.
const MAX_CHARS = 8000;

export async function embedQuery(query: string, apiKey: string): Promise<number[]> {
  if (query.trim().length === 0) {
    throw new Error("embedQuery: empty query");
  }
  const input = query.length > MAX_CHARS ? query.slice(0, MAX_CHARS) : query;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: MODEL, input }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  const vec = json.data[0]?.embedding;
  if (!vec || vec.length !== 1536) {
    throw new Error(`OpenAI embeddings: unexpected shape`);
  }
  return vec;
}
