const MODEL = "text-embedding-3-small";
const ENDPOINT = "https://api.openai.com/v1/embeddings";

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function embedBatch(
  inputs: string[],
  apiKey: string,
): Promise<number[][]> {
  if (inputs.length === 0) {
    throw new Error("embedBatch: empty input array");
  }

  async function attempt(): Promise<Response> {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, input: inputs }),
    });
  }

  let res = await attempt();
  if (!res.ok && (res.status === 429 || res.status >= 500)) {
    await sleep(500);
    res = await attempt();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

export const MAX_BATCH = 50;

/** Embed a list of chunks in batches of MAX_BATCH, preserving order. */
export async function embedAll(
  contents: string[],
  apiKey: string,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < contents.length; i += MAX_BATCH) {
    const batch = contents.slice(i, i + MAX_BATCH);
    const vectors = await embedBatch(batch, apiKey);
    out.push(...vectors);
  }
  return out;
}
