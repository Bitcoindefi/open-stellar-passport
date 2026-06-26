import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import crypto from "crypto";
import { POST as subscribeRoute } from "../../../app/api/protocol/passport/webhooks/route";
import { POST as issueRoute } from "../../../app/api/protocol/passport/route";
import { POST as revokeRoute } from "../../../app/api/protocol/passport/[id]/revoke/route";
import { POST as cronRoute } from "../../../app/api/protocol/passport/cron/route";
import { _reset as resetStore } from "./webhook-store";
import { NextRequest } from "next/server";

interface RequestInitWithHeaders extends RequestInit {
  headers?: Record<string, string>;
}

let fetchCalls: { url: string; init?: RequestInitWithHeaders }[] = [];
let fetchResponses: (() => Response)[] = [];

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

// Stub global fetch
vi.stubGlobal("fetch", async (url: string, init?: RequestInitWithHeaders) => {
  fetchCalls.push({ url, init });
  if (fetchResponses.length > 0) {
    const nextResponse = fetchResponses.shift()!;
    return nextResponse();
  }
  return { ok: true, status: 200 } as Response;
});

function createJsonRequest(body: unknown, headers?: Record<string, string>) {
  return new Request("https://example.com", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("Webhook Notifier Integration Tests", () => {
  beforeEach(() => {
    resetStore();
    fetchCalls = [];
    fetchResponses = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes and triggers passport.issued webhook", async () => {
    // 1. Subscribe
    const subReq = createJsonRequest({
      url: "https://myservice.com/webhook",
      events: ["passport.issued"],
      secret: "my_shared_secret",
    });
    const subRes = await subscribeRoute(subReq);
    expect(subRes.status).toBe(201);
    const subData = (await subRes.json()) as { webhookId?: string };
    expect(subData.webhookId).toBeDefined();

    // 2. Issue Passport
    const issueReq = createJsonRequest({
      passportId: "pass-123",
      agentId: "agent-456",
      expiresAt: Date.now() + 3600_000,
    });
    const issueRes = await issueRoute(issueReq);
    expect(issueRes.status).toBe(200);

    // 3. Verify Webhook Delivery
    expect(fetchCalls.length).toBe(1);
    const call = fetchCalls[0];
    expect(call.url).toBe("https://myservice.com/webhook");
    expect(call.init?.method).toBe("POST");

    // Verify HMAC signature
    const signature = call.init?.headers?.["X-Open-Stellar-Signature"];
    expect(signature).toBeDefined();

    const bodyStr = call.init?.body as string;
    const computedSig = crypto.createHmac("sha256", "my_shared_secret").update(bodyStr).digest("hex");
    expect(signature).toBe(computedSig);

    const payload = JSON.parse(bodyStr) as { event: string; passportId: string; agentId: string };
    expect(payload.event).toBe("passport.issued");
    expect(payload.passportId).toBe("pass-123");
    expect(payload.agentId).toBe("agent-456");
  });

  it("triggers passport.revoked webhook on manual revoke", async () => {
    // 1. Subscribe
    const subReq = createJsonRequest({
      url: "https://myservice.com/webhook",
      events: ["passport.revoked"],
      secret: "my_shared_secret",
    });
    await subscribeRoute(subReq);

    // 2. Issue first so it exists
    const issueReq = createJsonRequest({
      passportId: "pass-123",
      agentId: "agent-456",
    });
    await issueRoute(issueReq);

    // Reset fetchCalls since passport.issued isn't subscribed
    fetchCalls = [];

    // 3. Revoke
    const revokeRes = await revokeRoute(createJsonRequest({}), {
      params: { id: "pass-123" },
    });
    expect(revokeRes.status).toBe(200);

    // 4. Verify Webhook Delivery
    expect(fetchCalls.length).toBe(1);
    const call = fetchCalls[0];
    expect(call.url).toBe("https://myservice.com/webhook");
    const payload = JSON.parse(call.init?.body as string) as {
      event: string;
      passportId: string;
      agentId: string;
    };
    expect(payload.event).toBe("passport.revoked");
    expect(payload.passportId).toBe("pass-123");
    expect(payload.agentId).toBe("agent-456");
  });

  it("triggers passport.expired webhook on cron execution", async () => {
    // 1. Subscribe
    const subReq = createJsonRequest({
      url: "https://myservice.com/webhook",
      events: ["passport.expired"],
      secret: "my_shared_secret",
    });
    await subscribeRoute(subReq);

    // 2. Issue a passport that expires in 10 seconds
    const expiresAt = Date.now() + 10_000;
    const issueReq = createJsonRequest({
      passportId: "pass-123",
      agentId: "agent-456",
      expiresAt,
    });
    await issueRoute(issueReq);

    // 3. Run cron before expiry -> nothing happens
    fetchCalls = [];
    let cronRes = await cronRoute();
    expect(cronRes.status).toBe(200);
    expect((await cronRes.json() as { expiredCount: number }).expiredCount).toBe(0);
    expect(fetchCalls.length).toBe(0);

    // 4. Advance time by 11 seconds (so it is expired)
    vi.advanceTimersByTime(11_000);

    // 5. Run cron after expiry -> triggers webhook
    cronRes = await cronRoute();
    expect(cronRes.status).toBe(200);
    expect((await cronRes.json() as { expiredCount: number }).expiredCount).toBe(1);

    expect(fetchCalls.length).toBe(1);
    const call = fetchCalls[0];
    const payload = JSON.parse(call.init?.body as string) as {
      event: string;
      passportId: string;
      agentId: string;
    };
    expect(payload.event).toBe("passport.expired");
    expect(payload.passportId).toBe("pass-123");
    expect(payload.agentId).toBe("agent-456");
  });

  it("retries delivery with exponential backoff on failure", async () => {
    // 1. Subscribe
    const subReq = createJsonRequest({
      url: "https://myservice.com/webhook",
      events: ["passport.issued"],
      secret: "my_shared_secret",
    });
    await subscribeRoute(subReq);

    // 2. Setup mock responses (4 failed attempts, then 1 success)
    fetchResponses = [
      () => ({ ok: false, status: 500 } as Response),
      () => ({ ok: false, status: 502 } as Response),
      () => {
        throw new Error("Network error");
      },
      () => ({ ok: false, status: 408 } as Response),
      () => ({ ok: true, status: 200 } as Response),
    ];

    // 3. Issue and initiate background deliveries
    const issueReq = createJsonRequest({
      passportId: "pass-123",
      agentId: "agent-456",
    });

    const notifyPromise = issueRoute(issueReq);

    // 4. Fast-forward through delays to satisfy backoff
    // Delays: 100ms, 200ms, 400ms, 800ms
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1600);
    }

    await notifyPromise;

    // Verify it attempted 5 times
    expect(fetchCalls.length).toBe(5);
  });
});
