import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { _reset as resetRateLimit } from "../../../../src/lib/rate-limit";
import { globalPassportStore } from "../../../../src/lib/passport-store";
import { NextRequest } from "next/server";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: Record<string, string> },
    ) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
  NextRequest: class {},
}));

function req(body: unknown, ip = "1.2.3.4") {
  return new Request("https://example.com/api/protocol/passport", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("POST /api/protocol/passport", () => {
  beforeEach(() => {
    resetRateLimit();
    globalPassportStore.reset();
    vi.useFakeTimers({ now: new Date("2026-06-27T00:00:00.000Z").getTime() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues passports for two service contexts for the same agent", async () => {
    const payment = await POST(
      req({
        agentId: "agent-1",
        spendCapXlm: 100,
        zkProofHash: "hash-payment",
        serviceContext: "payment-routing",
      }),
    );
    const data = await POST(
      req({
        agentId: "agent-1",
        spendCapXlm: 200,
        zkProofHash: "hash-data",
        serviceContext: "data-access",
      }),
    );

    expect(payment.status).toBe(201);
    expect(data.status).toBe(201);
    expect(globalPassportStore.listPassports("agent-1")).toHaveLength(2);
  });

  it("defaults omitted serviceContext to default", async () => {
    const response = await POST(
      req({
        agentId: "agent-2",
        spendCapXlm: 300,
        zkProofHash: "hash-default",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      passport: {
        agentId: "agent-2",
        serviceContext: "default",
      },
    });
  });

  it("returns 400 for an invalid serviceContext", async () => {
    const response = await POST(
      req({
        agentId: "agent-3",
        spendCapXlm: 300,
        zkProofHash: "hash-invalid",
        serviceContext: "invalid context",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      reason: "InvalidServiceContext",
    });
  });

  it("rate-limits the 6th request from the same IP", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await POST(
        req(
          {
            agentId: `agent-${i}`,
            spendCapXlm: 100,
            zkProofHash: `hash-${i}`,
          },
          "7.7.7.7",
        ),
      );
      expect(response.status).toBe(201);
    }

    const blocked = await POST(
      req(
        {
          agentId: "agent-6",
          spendCapXlm: 100,
          zkProofHash: "hash-6",
        },
        "7.7.7.7",
      ),
    );

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    await expect(blocked.json()).resolves.toEqual({ ok: false });
  });
});
