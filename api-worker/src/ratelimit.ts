const IP_LIMIT = 20;
const IP_WINDOW_SECONDS = 600;
const ORIGIN_LIMIT = 200;
const ORIGIN_WINDOW_SECONDS = 86_400;
const DAY_WINDOW_SECONDS = 86_400;

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function bumpCounter(
  kv: KVNamespace,
  key: string,
  limit: number,
  ttl: number,
): Promise<boolean> {
  const current = Number.parseInt((await kv.get(key)) ?? "0", 10);
  if (current >= limit) return false;
  await kv.put(key, String(current + 1), { expirationTtl: ttl });
  return true;
}

export async function checkIpLimit(
  kv: KVNamespace,
  ip: string,
): Promise<boolean> {
  return bumpCounter(kv, `rl:ip:${ip}`, IP_LIMIT, IP_WINDOW_SECONDS);
}

export async function checkOriginLimit(
  kv: KVNamespace,
  origin: string,
): Promise<boolean> {
  return bumpCounter(
    kv,
    `rl:origin:${origin}`,
    ORIGIN_LIMIT,
    ORIGIN_WINDOW_SECONDS,
  );
}

export async function checkTokenBudget(
  kv: KVNamespace,
  budget: number,
): Promise<boolean> {
  const key = `rl:tokens:${todayKey()}`;
  const current = Number.parseInt((await kv.get(key)) ?? "0", 10);
  return current < budget;
}

export async function incrementTokens(
  kv: KVNamespace,
  amount: number,
): Promise<void> {
  const key = `rl:tokens:${todayKey()}`;
  const current = Number.parseInt((await kv.get(key)) ?? "0", 10);
  await kv.put(key, String(current + amount), {
    expirationTtl: DAY_WINDOW_SECONDS,
  });
}

export const LIMITS = {
  IP_LIMIT,
  IP_WINDOW_SECONDS,
  ORIGIN_LIMIT,
  ORIGIN_WINDOW_SECONDS,
  DAY_WINDOW_SECONDS,
  DAILY_TOKEN_BUDGET: 500_000,
};
