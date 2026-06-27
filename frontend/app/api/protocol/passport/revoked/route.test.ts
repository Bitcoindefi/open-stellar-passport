import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { globalPassportStore } from "../../../../../src/lib/passport-store";
import { NextRequest } from "next/server";

vi.mock("next/server", () => ({
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
}));

function req() {
  return new Request("https://example.com/api/protocol/passport/revoked") as unknown as NextRequest;
}

describe("GET /api/protocol/passport/revoked", () => {
  beforeEach(() => {
    globalPassportStore.reset();
  });

  it("returns only explicitly revoked, non-expired passports", async () => {
    const agentId = "agent-1";
    const expiredAgentId = "agent-2";

    globalPassportStore.issuePassport(agentId, 100, "proof-1", 30);
    globalPassportStore.register(agentId, { circuitBreaker: { maxConsecutiveFailures: 3 } });
    globalPassportStore.revokePassport(agentId, "manual_revocation");

    globalPassportStore.issuePassport(expiredAgentId, 100, "proof-2", -1);
    globalPassportStore.register(expiredAgentId, { circuitBreaker: { maxConsecutiveFailures: 3 } });
    globalPassportStore.revokePassport(expiredAgentId, "manual_revocation");

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      agentId,
      reason: "manual_revocation",
    });
    expect(typeof data[0].revokedAt).toBe("string");
    expect(data.some((entry: { agentId: string }) => entry.agentId === expiredAgentId)).toBe(false);
  });
});
