import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { globalPassportStore } from "../../../../../../src/lib/passport-store";
import { GET } from "./route";

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

const limits = {
  spendLimits: {
    dailyMaxXlm: 50_000_000,
    weeklyMaxXlm: 100_000_000,
  },
};

function request(agentId?: string) {
  return new Request(
    "https://example.com/api/protocol/passport/bot-42/spend",
    {
      headers: agentId ? { "x-stellar-address": agentId } : undefined,
    },
  ) as unknown as NextRequest;
}

function context(agentId = "bot-42") {
  return { params: Promise.resolve({ agentId }) };
}

describe("GET /api/protocol/passport/[agentId]/spend", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    vi.useFakeTimers({
      now: new Date("2026-06-26T12:00:00.000Z").getTime(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sums three authorize events and returns limits and remaining stroops", async () => {
    globalPassportStore.issuePassport("bot-42", 100_000_000, "hash-42");
    globalPassportStore.authorizePassportSpend("bot-42", 5_000_000, limits);
    globalPassportStore.authorizePassportSpend("bot-42", 4_000_000, limits);
    globalPassportStore.authorizePassportSpend("bot-42", 5_500_000, limits);

    const response = await GET(request("bot-42"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      agentId: "bot-42",
      period: {
        dayStart: "2026-06-26T00:00:00.000Z",
        weekStart: "2026-06-22T00:00:00.000Z",
      },
      spent: {
        daily: "14500000",
        weekly: "14500000",
      },
      limits: {
        dailyMaxXlm: "50000000",
        weeklyMaxXlm: "100000000",
      },
      remaining: {
        daily: "35500000",
        weekly: "85500000",
      },
    });
  });

  it("resets daily spend at UTC midnight while retaining same-week spend", async () => {
    globalPassportStore.issuePassport("bot-42", 100_000_000, "hash-42");
    vi.setSystemTime(new Date("2026-06-25T23:59:59.000Z"));
    globalPassportStore.authorizePassportSpend("bot-42", 10_000_000, limits);
    vi.setSystemTime(new Date("2026-06-26T00:00:00.000Z"));
    globalPassportStore.authorizePassportSpend("bot-42", 4_000_000, limits);

    const response = await GET(request("bot-42"), context());
    const body = await response.json();

    expect(body.spent).toEqual({
      daily: "4000000",
      weekly: "14000000",
    });
    expect(body.remaining).toEqual({
      daily: "46000000",
      weekly: "86000000",
    });
  });

  it("returns 401 when the caller credential is missing or belongs to another agent", async () => {
    globalPassportStore.issuePassport("bot-42", 100_000_000, "hash-42");

    const missing = await GET(request(), context());
    const mismatched = await GET(request("bot-7"), context());

    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
    expect(mismatched.status).toBe(401);
    await expect(mismatched.json()).resolves.toEqual({
      ok: false,
      error: "Unauthorized",
    });
  });

  it("returns 404 for an agent with no passport or spend history", async () => {
    const response = await GET(request("missing-agent"), context("missing-agent"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "passport_not_found",
    });
  });
});
