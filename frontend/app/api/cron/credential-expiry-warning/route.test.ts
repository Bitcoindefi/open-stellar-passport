import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  addCredential,
  setLastWarned,
  _reset,
} from "../../../../src/lib/credential-expiry/credential-expiry-store";

// Mock next/server since next is not installed in the Vite frontend workspace
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock notification-store to spy on calls without side effects
vi.mock("@/lib/notifications/notification-store", () => ({
  addNotification: vi.fn(),
}));

// Imports must come AFTER vi.mock calls (hoisting)
import { GET } from "./route";
import { addNotification } from "@/lib/notifications/notification-store";


// ─── helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function makeCredential(id: string, passportId: string, expiresInDays: number) {
  const now = Date.now();
  return addCredential({ id, passportId, expiresAt: now + expiresInDays * DAY_MS });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("GET /api/cron/credential-expiry-warning", () => {
  beforeEach(() => {
    _reset();
    vi.clearAllMocks();
  });

  it("emits one notification per expiring credential → { warned: 2, skipped: 0 }", async () => {
    makeCredential("cred-a", "passport-a", 3);
    makeCredential("cred-b", "passport-b", 5);

    const res = await GET();
    const body = await res.json();

    expect(addNotification).toHaveBeenCalledTimes(2);
    expect(body).toEqual({ warned: 2, skipped: 0 });
  });

  it("payload contains credentialId, passportId, expiresAt, daysRemaining", async () => {
    const cred = makeCredential("cred-x", "passport-x", 3);

    await GET();

    const [passportId, fields] = (
      addNotification as ReturnType<typeof vi.fn>
    ).mock.calls[0];

    expect(passportId).toBe("passport-x");
    expect(fields.title).toBe("credential.expiring_soon");

    const payload = JSON.parse(fields.message);
    expect(payload).toMatchObject({
      credentialId: "cred-x",
      passportId: "passport-x",
      expiresAt: cred.expiresAt,
      daysRemaining: 3,
    });
  });

  it("skips a credential warned less than 24 h ago → { warned: 0, skipped: 1 }", async () => {
    makeCredential("cred-recent", "passport-1", 3);
    setLastWarned("cred-recent", Date.now() - 2 * 60 * 60 * 1000); // 2 h ago

    const res = await GET();
    const body = await res.json();

    expect(addNotification).not.toHaveBeenCalled();
    expect(body).toEqual({ warned: 0, skipped: 1 });
  });

  it("does not include already-expired credentials → { warned: 0, skipped: 0 }", async () => {
    makeCredential("cred-expired", "passport-1", -1); // expired yesterday

    const res = await GET();
    const body = await res.json();

    expect(addNotification).not.toHaveBeenCalled();
    expect(body).toEqual({ warned: 0, skipped: 0 });
  });
});
