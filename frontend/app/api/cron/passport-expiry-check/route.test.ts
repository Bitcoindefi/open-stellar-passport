import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, _resetWarnedSet } from "./route";
import { globalPassportStore } from "../../../../src/lib/passport-store";
import { getNotifications, _reset as resetNotifications } from "../../../../src/lib/notifications/notification-store";

describe("GET /api/cron/passport-expiry-check", () => {
  beforeEach(() => {
    globalPassportStore.reset();
    resetNotifications();
    _resetWarnedSet();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should warn for passports expiring within WARN_DAYS_BEFORE and skip others", async () => {
    const now = Date.now();
    vi.setSystemTime(now);

    // Expiring in 2 days (should warn)
    const agent1 = "agent-1";
    globalPassportStore.issuePassport(agent1, 100, "hash1");
    const p1 = globalPassportStore.getPassport(agent1)!;
    p1.expiresAt = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();

    // Expiring in 5 days (should NOT warn)
    const agent2 = "agent-2";
    globalPassportStore.issuePassport(agent2, 100, "hash2");
    const p2 = globalPassportStore.getPassport(agent2)!;
    p2.expiresAt = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString();

    // Already expired (should NOT warn)
    const agent3 = "agent-3";
    globalPassportStore.issuePassport(agent3, 100, "hash3");
    const p3 = globalPassportStore.getPassport(agent3)!;
    p3.expiresAt = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();

    const response = await GET();
    const data = await response.json();

    expect(data.checked).toBe(3);
    expect(data.warned).toBe(1);

    const n1 = getNotifications(agent1);
    expect(n1.length).toBe(1);
    expect(n1[0].title).toBe("passport.expiring_soon");

    const n2 = getNotifications(agent2);
    expect(n2.length).toBe(0);

    const n3 = getNotifications(agent3);
    expect(n3.length).toBe(0);

    // Call again, should be skipped due to dedupeKey
    const response2 = await GET();
    const data2 = await response2.json();
    expect(data2.checked).toBe(3);
    expect(data2.warned).toBe(0);
    expect(getNotifications(agent1).length).toBe(1); // Still 1
  });

  it("uses WARN_DAYS_BEFORE env var", async () => {
    const now = Date.now();
    vi.setSystemTime(now);

    process.env.WARN_DAYS_BEFORE = "6";

    // Expiring in 5 days (should warn now)
    const agent2 = "agent-2";
    globalPassportStore.issuePassport(agent2, 100, "hash2");
    const p2 = globalPassportStore.getPassport(agent2)!;
    p2.expiresAt = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString();

    const response = await GET();
    const data = await response.json();

    expect(data.checked).toBe(1);
    expect(data.warned).toBe(1);

    delete process.env.WARN_DAYS_BEFORE;
  });
});
