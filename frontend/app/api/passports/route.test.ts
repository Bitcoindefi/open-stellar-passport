import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GET } from "./route";
import { globalPassportStore } from "../../../src/lib/passport-store";
import { revokePassport, _reset as _resetRevocation } from "../../../src/lib/passport/revocation-store";
import { NextRequest } from "next/server";

// Mock next/server since next is not installed in the Vite frontend workspace
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

function req(params: Record<string, string> = {}) {
  const url = new URL("https://example.com/api/passports");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), { method: "GET" }) as unknown as NextRequest;
}

describe("GET /api/passports", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    _resetRevocation();
    vi.useFakeTimers({ now: new Date("2026-06-27T00:00:00.000Z").getTime() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns all passports paginated with no filters (newest-first default sort)", async () => {
    // Issue three passports at different times
    vi.setSystemTime(new Date("2026-06-27T01:00:00.000Z").getTime());
    globalPassportStore.issuePassport("agent-1", 100, "hash-1");

    vi.setSystemTime(new Date("2026-06-27T03:00:00.000Z").getTime());
    globalPassportStore.issuePassport("agent-2", 200, "hash-2");

    vi.setSystemTime(new Date("2026-06-27T02:00:00.000Z").getTime());
    globalPassportStore.issuePassport("agent-3", 300, "hash-3");

    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total).toBe(3);
    expect(data.page).toBe(1);
    expect(data.pageSize).toBe(20);
    expect(data.filters).toEqual({});

    // Verify default sort (newest first: agent-2, agent-3, agent-1)
    expect(data.passports).toHaveLength(3);
    expect(data.passports[0].agentId).toBe("agent-2");
    expect(data.passports[1].agentId).toBe("agent-3");
    expect(data.passports[2].agentId).toBe("agent-1");
  });

  it("filters by agentId", async () => {
    globalPassportStore.issuePassport("agent-1", 100, "hash-1");
    globalPassportStore.issuePassport("agent-2", 200, "hash-2");

    const res = await GET(req({ agentId: "agent-1" }));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.passports[0].agentId).toBe("agent-1");
    expect(data.filters).toEqual({ agentId: "agent-1" });
  });

  it("filters by status (active, revoked, suspended, expired)", async () => {
    // 1. Active passport
    globalPassportStore.issuePassport("agent-active", 100, "hash-1");

    // 2. Revoked passport
    globalPassportStore.issuePassport("agent-revoked", 100, "hash-2");
    revokePassport("agent-revoked");

    // 3. Suspended passport
    globalPassportStore.issuePassport("agent-suspended", 100, "hash-3");
    globalPassportStore.suspendPassport("agent-suspended");

    // 4. Expired passport
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z").getTime());
    globalPassportStore.issuePassport("agent-expired", 100, "hash-4", 2); // TTL = 2 days
    vi.setSystemTime(new Date("2026-06-27T00:00:00.000Z").getTime()); // Jump to present

    // Test active filter
    const resActive = await GET(req({ status: "active" }));
    const dataActive = await resActive.json();
    expect(dataActive.total).toBe(1);
    expect(dataActive.passports[0].agentId).toBe("agent-active");

    // Test revoked filter
    const resRevoked = await GET(req({ status: "revoked" }));
    const dataRevoked = await resRevoked.json();
    expect(dataRevoked.total).toBe(1);
    expect(dataRevoked.passports[0].agentId).toBe("agent-revoked");

    // Test suspended filter
    const resSuspended = await GET(req({ status: "suspended" }));
    const dataSuspended = await resSuspended.json();
    expect(dataSuspended.total).toBe(1);
    expect(dataSuspended.passports[0].agentId).toBe("agent-suspended");

    // Test expired filter
    const resExpired = await GET(req({ status: "expired" }));
    const dataExpired = await resExpired.json();
    expect(dataExpired.total).toBe(1);
    expect(dataExpired.passports[0].agentId).toBe("agent-expired");
  });

  it("filters by issuer", async () => {
    globalPassportStore.issuePassport("agent-1", 100, "hash-1", 30, "issuer-A");
    globalPassportStore.issuePassport("agent-2", 200, "hash-2", 30, "issuer-B");

    const res = await GET(req({ issuer: "issuer-A" }));
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.passports[0].agentId).toBe("agent-1");
    expect(data.filters).toEqual({ issuer: "issuer-A" });
  });

  it("filters by date range (issuedAfter / issuedBefore)", async () => {
    vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z").getTime());
    globalPassportStore.issuePassport("agent-1", 100, "hash-1");

    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z").getTime());
    globalPassportStore.issuePassport("agent-2", 200, "hash-2");

    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z").getTime());
    globalPassportStore.issuePassport("agent-3", 300, "hash-3");

    // Test issuedAfter
    const resAfter = await GET(req({ issuedAfter: "2026-06-15T00:00:00.000Z" }));
    const dataAfter = await resAfter.json();
    expect(dataAfter.total).toBe(2); // agent-2, agent-3

    // Test issuedBefore
    const resBefore = await GET(req({ issuedBefore: "2026-06-16T00:00:00.000Z" }));
    const dataBefore = await resBefore.json();
    expect(dataBefore.total).toBe(2); // agent-1, agent-2

    // Test range
    const resRange = await GET(req({
      issuedAfter: "2026-06-11T00:00:00.000Z",
      issuedBefore: "2026-06-16T00:00:00.000Z"
    }));
    const dataRange = await resRange.json();
    expect(dataRange.total).toBe(1); // agent-2 only
  });

  it("caps pageSize at 100 and defaults to page 1, size 20", async () => {
    // Generate 120 passports
    for (let i = 0; i < 120; i++) {
      globalPassportStore.issuePassport(`agent-${i}`, 10, `hash-${i}`);
    }

    const resDefault = await GET(req());
    const dataDefault = await resDefault.json();
    expect(dataDefault.pageSize).toBe(20);
    expect(dataDefault.passports).toHaveLength(20);

    const resCap = await GET(req({ pageSize: "150" }));
    const dataCap = await resCap.json();
    expect(dataCap.pageSize).toBe(100);
    expect(dataCap.passports).toHaveLength(100);
  });

  it("paginates through multiple pages", async () => {
    for (let i = 1; i <= 25; i++) {
      globalPassportStore.issuePassport(`agent-${i}`, 10, `hash-${i}`);
    }

    const resPage2 = await GET(req({ page: "2", pageSize: "10" }));
    const dataPage2 = await resPage2.json();
    expect(dataPage2.total).toBe(25);
    expect(dataPage2.page).toBe(2);
    expect(dataPage2.pageSize).toBe(10);
    expect(dataPage2.passports).toHaveLength(10);
  });

  it("returns empty result if no passports match filters", async () => {
    globalPassportStore.issuePassport("agent-1", 100, "hash-1");
    const res = await GET(req({ agentId: "nonexistent" }));
    const data = await res.json();
    expect(data.total).toBe(0);
    expect(data.passports).toHaveLength(0);
  });

  it("sorts by status alphabetically when sort=status is requested", async () => {
    // Status alphabetical order: active, expired, revoked, suspended

    globalPassportStore.issuePassport("agent-suspended", 100, "hash-3");
    globalPassportStore.suspendPassport("agent-suspended");

    globalPassportStore.issuePassport("agent-revoked", 100, "hash-2");
    revokePassport("agent-revoked");

    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z").getTime());
    globalPassportStore.issuePassport("agent-expired", 100, "hash-4", 2); // expired
    vi.setSystemTime(new Date("2026-06-27T00:00:00.000Z").getTime());

    globalPassportStore.issuePassport("agent-active", 100, "hash-1");

    const res = await GET(req({ sort: "status" }));
    const data = await res.json();

    expect(data.passports).toHaveLength(4);
    expect(data.passports[0].status).toBe("active");
    expect(data.passports[1].status).toBe("expired");
    expect(data.passports[2].status).toBe("revoked");
    expect(data.passports[3].status).toBe("suspended");
  });
});
