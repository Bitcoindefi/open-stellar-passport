import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { POST } from "./route";
import { _reset } from "../../../../src/lib/rate-limit";
import { NextRequest } from "next/server";

// Mock next/server since next is not installed in the Vite frontend workspace
vi.mock("next/server", () => {
  return {
    NextResponse: {
      json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => {
        const headers = new Headers(init?.headers);
        return {
          status: init?.status ?? 200,
          headers,
          json: async () => body,
        } as unknown as Response;
      },
    },
    NextRequest: class {},
  };
});

function req(ip = "1.2.3.4") {
  return new Request("https://example.com/api/protocol/passport", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  }) as unknown as NextRequest;
}

describe("POST /api/protocol/passport rate limiting", () => {
  beforeEach(() => {
    _reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows 5 requests from the same IP, but blocks the 6th with 429", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(req("1.1.1.1"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ ok: true });
    }

    const res6 = await POST(req("1.1.1.1"));
    expect(res6.status).toBe(429);
    expect(res6.headers.get("Retry-After")).toBe("60");
    const data6 = await res6.json();
    expect(data6).toEqual({ ok: false });
  });

  it("handles different IPs independently", async () => {
    for (let i = 0; i < 5; i++) {
      await POST(req("1.1.1.1"));
    }

    // 6th request from 1.1.1.1 is blocked
    const resBlocked = await POST(req("1.1.1.1"));
    expect(resBlocked.status).toBe(429);

    // 1st request from 2.2.2.2 is allowed
    const resAllowed = await POST(req("2.2.2.2"));
    expect(resAllowed.status).toBe(200);
  });

  it("allows requests again after the rate limit window resets", async () => {
    for (let i = 0; i < 5; i++) {
      await POST(req("1.1.1.1"));
    }

    const resBlocked = await POST(req("1.1.1.1"));
    expect(resBlocked.status).toBe(429);

    // Advance time by 60 seconds (windowMs is 60_000)
    vi.advanceTimersByTime(60_001);

    const resAllowed = await POST(req("1.1.1.1"));
    expect(resAllowed.status).toBe(200);
  });
});
