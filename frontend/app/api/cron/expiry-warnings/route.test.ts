import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, _resetWarningsStore } from "./route";
import { globalPassportStore } from "../../../../src/lib/passport-store";
import * as webhooks from "../../../../src/lib/webhooks";

// Mock next/server
vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn().mockImplementation((body, init) => ({
      json: async () => body,
      status: init?.status ?? 200,
    })),
  },
}));

// Mock webhooks
vi.mock("../../../../src/lib/webhooks", () => ({
  emitWebhook: vi.fn(),
}));

describe("GET /api/cron/expiry-warnings", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    _resetWarningsStore();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should trigger passport.expiring_soon for passport expiring in 6 days", async () => {
    const passport = globalPassportStore.issuePassport("bot-1", 100, "hash1", 6);
    
    // Explicitly set expiry to 6 days exactly
    passport.expiresAt = new Date("2026-07-07T00:00:00Z").toISOString();

    const response = await GET();
    const data = await response.json();

    expect(data).toEqual({ checked: 1, warned: 1, skipped: 0 });
    expect(webhooks.emitWebhook).toHaveBeenCalledWith(
      "bot-1",
      "passport.expiring_soon",
      {
        passportId: "bot-1",
        expiresAt: passport.expiresAt,
        daysRemaining: 6,
      }
    );
  });

  it("should NOT trigger for passport expiring in 8 days", async () => {
    const passport = globalPassportStore.issuePassport("bot-2", 100, "hash2", 8);
    passport.expiresAt = new Date("2026-07-09T00:00:00Z").toISOString();

    const response = await GET();
    const data = await response.json();

    expect(data).toEqual({ checked: 1, warned: 0, skipped: 1 });
    expect(webhooks.emitWebhook).not.toHaveBeenCalled();
  });

  it("should NOT trigger for already-expired passport", async () => {
    const passport = globalPassportStore.issuePassport("bot-3", 100, "hash3", -1);
    passport.expiresAt = new Date("2026-06-30T00:00:00Z").toISOString();

    const response = await GET();
    const data = await response.json();

    expect(data).toEqual({ checked: 1, warned: 0, skipped: 1 });
    expect(webhooks.emitWebhook).not.toHaveBeenCalled();
  });

  it("should NOT warn same passport twice in the same 7-day window", async () => {
    const passport = globalPassportStore.issuePassport("bot-4", 100, "hash4", 6);
    passport.expiresAt = new Date("2026-07-07T00:00:00Z").toISOString();

    // First run - should warn
    let response = await GET();
    let data = await response.json();
    expect(data).toEqual({ checked: 1, warned: 1, skipped: 0 });

    // Advance time by 1 day
    vi.setSystemTime(new Date("2026-07-02T00:00:00Z"));
    
    // Second run - should skip
    response = await GET();
    data = await response.json();
    expect(data).toEqual({ checked: 1, warned: 0, skipped: 1 });
    
    expect(webhooks.emitWebhook).toHaveBeenCalledTimes(1);

    // Advance time by 7 days from the first warning (to simulate next window, though passport expires before this)
    // Let's extend the passport expiry just for this test
    passport.expiresAt = new Date("2026-07-15T00:00:00Z").toISOString();
    vi.setSystemTime(new Date("2026-07-09T00:00:00Z"));

    // Third run - should warn again (new window)
    response = await GET();
    data = await response.json();
    expect(data).toEqual({ checked: 1, warned: 1, skipped: 0 });
    expect(webhooks.emitWebhook).toHaveBeenCalledTimes(2);
  });
});
