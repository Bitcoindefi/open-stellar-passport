import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { _reset as resetRevocation } from "../../../../../src/lib/passport/revocation-store";
import { globalPassportStore } from "../../../../../src/lib/passport-store";

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

function context(agentId = "agent-1") {
  return { params: Promise.resolve({ agentId }) };
}

describe("GET /api/protocol/passport/[agentId]", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    resetRevocation();
    vi.useFakeTimers({ now: new Date("2026-06-27T00:00:00.000Z").getTime() });
  });

  it("returns the default-context passport for backward compatibility", async () => {
    globalPassportStore.issuePassport("agent-1", 100, "hash-default");
    globalPassportStore.issuePassport(
      "agent-1",
      200,
      "hash-data",
      30,
      undefined,
      "data-access",
    );

    const response = await GET(
      new Request("https://example.com") as Request,
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      agentId: "agent-1",
      serviceContext: "default",
      spendCapXlm: 100,
    });
  });

  it("returns 404 when the default-context passport does not exist", async () => {
    globalPassportStore.issuePassport(
      "agent-1",
      200,
      "hash-data",
      30,
      undefined,
      "data-access",
    );

    const response = await GET(
      new Request("https://example.com") as Request,
      context(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "passport_not_found",
    });
  });
});
