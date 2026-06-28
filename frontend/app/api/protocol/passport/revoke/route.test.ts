import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { POST } from "./route";
import { _reset as _resetRateLimit } from "../../../../../src/lib/rate-limit";
import {
  _reset as _resetRevocation,
  isRevoked,
} from "../../../../../src/lib/passport/revocation-store";
import { NextRequest } from "next/server";

vi.mock("next/server", () => {
  return {
    NextResponse: {
      json: (
        body: unknown,
        init?: { status?: number; headers?: Record<string, string> },
      ) => {
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

function req(body: unknown, ip = "1.2.3.4") {
  return new Request("https://example.com/api/protocol/passport/revoke", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/protocol/passport/revoke", () => {
  beforeEach(() => {
    _resetRateLimit();
    _resetRevocation();
    vi.useFakeTimers({ now: new Date("2025-06-01T00:00:00.000Z").getTime() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 200 with revokedAt when agentId is provided", async () => {
    const res = await POST(req({ agentId: "agent-A" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.revokedAt).toBe("2025-06-01T00:00:00.000Z");
  });

  it("marks only the requested service context as revoked", async () => {
    await POST(req({ agentId: "agent-B", serviceContext: "data-access" }));
    expect(isRevoked("agent-B", "data-access")).toBe(true);
    expect(isRevoked("agent-B", "payment-routing")).toBe(false);
    expect(isRevoked("agent-B")).toBe(false);
  });

  it("is idempotent for the same agent and context", async () => {
    await POST(req({ agentId: "agent-C", serviceContext: "data-access" }));
    const res2 = await POST(
      req({ agentId: "agent-C", serviceContext: "data-access" }),
    );
    expect(res2.status).toBe(200);
    expect(isRevoked("agent-C", "data-access")).toBe(true);
  });

  it("revocation is case-insensitive in the store for agentId", async () => {
    await POST(req({ agentId: "Agent-D", serviceContext: "data-access" }));
    expect(isRevoked("agent-d", "data-access")).toBe(true);
  });

  it("revocation trims whitespace from agentId", async () => {
    await POST(req({ agentId: "  agent-E  ", serviceContext: "data-access" }));
    expect(isRevoked("agent-e", "data-access")).toBe(true);
  });

  it("returns 400 when agentId is missing from body", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({ ok: false, reason: "MissingFields" });
  });

  it("returns 400 for an invalid serviceContext", async () => {
    const res = await POST(
      req({ agentId: "agent-F", serviceContext: "invalid context" }),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      reason: "InvalidServiceContext",
    });
  });

  it("returns 429 after 10 requests from the same IP", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await POST(req({ agentId: `agent-rl-${i}` }, "5.5.5.5"));
      expect(res.status).toBe(200);
    }
    const blocked = await POST(req({ agentId: "agent-rl-extra" }, "5.5.5.5"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    const data = await blocked.json();
    expect(data).toEqual({ ok: false });
  });
});
