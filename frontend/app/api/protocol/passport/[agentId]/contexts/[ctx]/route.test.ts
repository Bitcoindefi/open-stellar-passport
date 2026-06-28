import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { globalPassportStore } from "../../../../../../../src/lib/passport-store";

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
}));

function context(agentId = "agent-1", ctx = "data-access") {
  return { params: Promise.resolve({ agentId, ctx }) };
}

describe("GET /api/protocol/passport/[agentId]/contexts/[ctx]", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    vi.useFakeTimers({ now: new Date("2026-06-27T00:00:00.000Z").getTime() });
  });

  it("returns the passport for the requested service context", async () => {
    globalPassportStore.issuePassport("agent-1", 200, "hash-data", 30, undefined, "data-access");

    const response = await GET(new Request("https://example.com") as Request, context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      agentId: "agent-1",
      serviceContext: "data-access",
    });
  });

  it("returns 400 for an invalid service context", async () => {
    const response = await GET(new Request("https://example.com") as Request, context("agent-1", "bad ctx"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_service_context",
    });
  });
});
