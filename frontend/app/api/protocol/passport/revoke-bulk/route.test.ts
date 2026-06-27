import { describe, expect, it, beforeEach, vi } from "vitest";
import { POST, auditLog } from "./route";
import { _reset as resetRevocationStore, revokePassport } from "../../../../../src/lib/passport/revocation-store";
import { globalPassportStore } from "../../../../../src/lib/passport-store";
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

function req(body: unknown, token = "test-secret") {
  return new Request("https://example.com/api/protocol/passport/revoke-bulk", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/protocol/passport/revoke-bulk", () => {
  beforeEach(() => {
    resetRevocationStore();
    globalPassportStore.reset();
    auditLog.length = 0;
    process.env.ADMIN_SECRET = "test-secret";
  });

  it("requires a valid admin token", async () => {
    const res = await POST(req({ agentIds: ["agent-1"] }, "wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("rejects more than 50 agentIds", async () => {
    const agentIds = Array.from({ length: 51 }, (_, i) => `agent-${i}`);
    const res = await POST(req({ agentIds }));
    expect(res.status).toBe(400);
  });

  it("processes a mix of valid, not-found, and already-revoked agentIds", async () => {
    // 1. Setup passports
    globalPassportStore.issuePassport("agent-valid-1", 100, "hash1");
    globalPassportStore.issuePassport("agent-valid-2", 100, "hash2");
    globalPassportStore.issuePassport("agent-already-revoked", 100, "hash3");

    // 2. Setup already revoked
    revokePassport("agent-already-revoked");

    // 3. Request bulk revoke
    const agentIds = [
      "agent-valid-1",
      "agent-valid-2",
      "agent-not-found",
      "agent-already-revoked"
    ];

    const res = await POST(req({ agentIds }));
    expect(res.status).toBe(200);

    const data = await res.json() as any;
    expect(data.revoked).toEqual(["agent-valid-1", "agent-valid-2"]);
    expect(data.notFound).toEqual(["agent-not-found"]);
    expect(data.alreadyRevoked).toEqual(["agent-already-revoked"]);

    // 4. Verify audit log
    expect(auditLog.length).toBe(2);
    expect(auditLog[0].agentId).toBe("agent-valid-1");
    expect(auditLog[0].action).toBe(Symbol.for("bulk_revoke"));
    expect(auditLog[1].agentId).toBe("agent-valid-2");
    expect(auditLog[1].action).toBe(Symbol.for("bulk_revoke"));
  });
});
