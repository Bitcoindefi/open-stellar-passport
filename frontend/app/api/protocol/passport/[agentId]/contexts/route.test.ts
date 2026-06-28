import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { globalPassportStore } from "../../../../../../src/lib/passport-store";
import {
  _reset as resetRevocation,
  revokePassport,
} from "../../../../../../src/lib/passport/revocation-store";

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

describe("GET /api/protocol/passport/[agentId]/contexts", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    resetRevocation();
    vi.useFakeTimers({ now: new Date("2026-06-27T00:00:00.000Z").getTime() });
  });

  it("lists all passports for the agent across contexts", async () => {
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
      contexts: ["default", "data-access"],
    });
  });

  it("still lists the other context after one context is revoked", async () => {
    globalPassportStore.issuePassport("agent-1", 100, "hash-default");
    globalPassportStore.issuePassport(
      "agent-1",
      200,
      "hash-data",
      30,
      undefined,
      "data-access",
    );
    revokePassport("agent-1", "data-access");

    const response = await GET(
      new Request("https://example.com") as Request,
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.passports).toHaveLength(2);
    expect(body.contexts).toEqual(["default", "data-access"]);
  });
});
