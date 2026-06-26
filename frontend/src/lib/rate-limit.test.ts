import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { rateLimitExceeded, _reset } from "./rate-limit";

function req(url: string, ip = "1.2.3.4") {
  return new Request(url, {
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimitExceeded", () => {
  beforeEach(() => {
    _reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests within limit", () => {
    for (let i = 0; i < 10; i++) {
      const r = rateLimitExceeded(req("https://example.com/api/agents/heartbeat"));
      expect(r.exceeded).toBe(false);
    }
  });

  it("blocks the 11th request on heartbeat route within window", () => {
    for (let i = 0; i < 10; i++) {
      rateLimitExceeded(req("https://example.com/api/agents/heartbeat"));
    }
    const r = rateLimitExceeded(req("https://example.com/api/agents/heartbeat"));
    expect(r.exceeded).toBe(true);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("returns 429 response with Retry-After header", () => {
    for (let i = 0; i < 10; i++) {
      rateLimitExceeded(req("https://example.com/api/agents/heartbeat"));
    }
    const { exceeded, retryAfterSeconds } = rateLimitExceeded(
      req("https://example.com/api/agents/heartbeat")
    );
    expect(exceeded).toBe(true);
    expect(retryAfterSeconds).toBeGreaterThan(0);
    expect(retryAfterSeconds).toBeLessThanOrEqual(15);
  });

  it("resets after window elapses", () => {
    for (let i = 0; i < 10; i++) {
      rateLimitExceeded(req("https://example.com/api/agents/heartbeat"));
    }
    const blocked = rateLimitExceeded(req("https://example.com/api/agents/heartbeat"));
    expect(blocked.exceeded).toBe(true);

    vi.advanceTimersByTime(15_001);

    const allowed = rateLimitExceeded(req("https://example.com/api/agents/heartbeat"));
    expect(allowed.exceeded).toBe(false);
  });

  it("tracks different IPs separately", () => {
    for (let i = 0; i < 15; i++) {
      rateLimitExceeded(req("https://example.com/api/agents/heartbeat", "1.1.1.1"));
    }
    const blocked = rateLimitExceeded(req("https://example.com/api/agents/heartbeat", "1.1.1.1"));
    expect(blocked.exceeded).toBe(true);

    const allowed = rateLimitExceeded(req("https://example.com/api/agents/heartbeat", "2.2.2.2"));
    expect(allowed.exceeded).toBe(false);
  });

  it("applies different limits per route", () => {
    for (let i = 0; i < 30; i++) {
      rateLimitExceeded(req("https://example.com/api/protocol/reputation"));
    }
    const blocked = rateLimitExceeded(req("https://example.com/api/protocol/reputation"));
    expect(blocked.exceeded).toBe(true);

    const allowed = rateLimitExceeded(req("https://example.com/api/agents/heartbeat"));
    expect(allowed.exceeded).toBe(false);
  });
});
