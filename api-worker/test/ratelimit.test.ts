import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import {
  checkIpLimit,
  checkOriginLimit,
  checkTokenBudget,
  incrementTokens,
} from "../src/ratelimit";

describe("rate limiter", () => {
  it("checkIpLimit allows up to 20 requests, denies 21st", async () => {
    const kv = env.RATE_LIMIT;
    for (let i = 0; i < 20; i++) {
      const ok = await checkIpLimit(kv, "1.1.1.1");
      expect(ok).toBe(true);
    }
    const blocked = await checkIpLimit(kv, "1.1.1.1");
    expect(blocked).toBe(false);
  });

  it("checkIpLimit treats different IPs independently", async () => {
    const kv = env.RATE_LIMIT;
    for (let i = 0; i < 20; i++) await checkIpLimit(kv, "2.2.2.2");
    const blocked = await checkIpLimit(kv, "2.2.2.2");
    expect(blocked).toBe(false);
    const otherOk = await checkIpLimit(kv, "3.3.3.3");
    expect(otherOk).toBe(true);
  });

  it("checkOriginLimit allows 200, blocks 201", async () => {
    const kv = env.RATE_LIMIT;
    for (let i = 0; i < 200; i++) {
      const ok = await checkOriginLimit(kv, "example.com");
      expect(ok).toBe(true);
    }
    const blocked = await checkOriginLimit(kv, "example.com");
    expect(blocked).toBe(false);
  });

  it("checkTokenBudget returns true when unused", async () => {
    const kv = env.RATE_LIMIT;
    const ok = await checkTokenBudget(kv, 500_000);
    expect(ok).toBe(true);
  });

  it("incrementTokens accumulates; budget blocks once exceeded", async () => {
    const kv = env.RATE_LIMIT;
    await incrementTokens(kv, 400_000);
    expect(await checkTokenBudget(kv, 500_000)).toBe(true);
    await incrementTokens(kv, 200_000);
    expect(await checkTokenBudget(kv, 500_000)).toBe(false);
  });
});
