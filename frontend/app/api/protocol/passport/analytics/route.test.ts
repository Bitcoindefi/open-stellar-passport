import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import { globalPassportStore } from "../../../../../src/lib/passport-store";
import { revokePassport, _reset as _resetRevocation } from "../../../../../src/lib/passport/revocation-store";

// Mock next/server since Next.js is not installed in the Vite frontend workspace
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

function req(url: string) {
  return new Request(url) as unknown as NextRequest;
}

describe("GET /api/protocol/passport/analytics", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    _resetRevocation();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns aggregated counts for active / revoked / expired / expiring", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z").getTime());

    // active (not revoked, not expired, not necessarily expiring)
    globalPassportStore.issuePassport("agent-active", 100, "hash-a", 30);

    // revoked (regardless of expiry)
    globalPassportStore.issuePassport("agent-revoked", 100, "hash-r", 30);
    revokePassport("agent-revoked");

    // expired (not revoked)
    globalPassportStore.issuePassport("agent-expired", 100, "hash-e", 1);
    // advance beyond expiry
    vi.setSystemTime(new Date("2025-01-10T00:00:00.000Z").getTime());

    // expiring (not revoked, not expired, expires within 7 days)
    globalPassportStore.issuePassport("agent-expiring", 100, "hash-x", 5);

    // Now compute
    const url = "https://example.com/api/protocol/passport/analytics?expiringWithinDays=7";
    const res = await GET(req(url));
    expect(res.status).toBe(200);
    const data = await res.json();

    // We are at 2025-01-10
    // - agent-active expires 2025-01-31 -> active
    // - agent-revoked expires 2025-01-31 but revoked
    // - agent-expired expires 2025-01-02 -> expired
    // - agent-expiring expires 2025-01-15 -> expiring
    expect(data.ok).toBe(true);
    expect(data.total).toBe(4);
    expect(data.active).toBe(1);
    expect(data.revoked).toBe(1);
    expect(data.expired).toBe(1);
    expect(data.expiring).toBe(1);
  });

  it("returns 400 for invalid expiringWithinDays", async () => {
    const res = await GET(
      req("https://example.com/api/protocol/passport/analytics?expiringWithinDays=abc"),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({ ok: false, reason: "InvalidExpiringWindow" });
  });
});

