import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { GET, setMockChecks } from "./route";
import { globalPassportStore } from "../../../../src/lib/passport-store";
import {
  revokePassport,
  _reset as _resetRevocation,
} from "../../../../src/lib/passport/revocation-store";
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

function req() {
  const url = new URL("https://example.com/api/health/passport");
  return new Request(url.toString(), { method: "GET" }) as unknown as NextRequest;
}

describe("GET /api/health/passport", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    _resetRevocation();
    // Reset mock checks before each test
    setMockChecks({
      passportStore: "ok",
      webhookDispatch: "ok",
      cronJobs: "ok",
    });
    vi.useFakeTimers({ now: new Date("2026-06-27T00:00:00.000Z").getTime() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns healthy scenario when all checks are ok", async () => {
    globalPassportStore.issuePassport("agent-1", 500, "hash-1");
    globalPassportStore.issuePassport("agent-2", 1000, "hash-2");
    
    // Revoke agent-2 so activeCount becomes 1
    revokePassport("agent-2");

    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.status).toBe("healthy");
    expect(data.checks).toEqual({
      passportStore: "ok",
      webhookDispatch: "ok",
      cronJobs: "ok",
    });
    expect(data.passportCount).toBe(2);
    expect(data.activeCount).toBe(1);
    expect(data.timestamp).toBe("2026-06-27T00:00:00.000Z");
    expect(data.uptimeMs).toBeTypeOf("number");
  });

  it("returns degraded scenario when only webhookDispatch or cronJobs fail", async () => {
    setMockChecks({ webhookDispatch: "error" });
    
    const res1 = await GET(req());
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.status).toBe("degraded");
    expect(data1.checks.webhookDispatch).toBe("error");
    expect(data1.checks.passportStore).toBe("ok");

    setMockChecks({ webhookDispatch: "ok", cronJobs: "error" });
    
    const res2 = await GET(req());
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.status).toBe("degraded");
    expect(data2.checks.cronJobs).toBe("error");
    expect(data2.checks.passportStore).toBe("ok");
  });

  it("returns unhealthy scenario with 503 when passportStore is error", async () => {
    setMockChecks({ passportStore: "error", cronJobs: "error" });
    
    const res = await GET(req());
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe("unhealthy");
    expect(data.checks).toEqual({
      passportStore: "error",
      webhookDispatch: "ok",
      cronJobs: "error",
    });
  });
});
