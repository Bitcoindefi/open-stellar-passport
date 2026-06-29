import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { clearXPMultiplier } from "@/lib/gamification/xp-multiplier"
import { POST, DELETE } from "@/app/api/admin/xp-multiplier/route"

// Mock next/server for route handler tests (same shape as the admin-audit test).
vi.mock("next/server", () => {
  return {
    NextResponse: {
      json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => {
        const headers = new Headers(init?.headers)
        return {
          status: init?.status ?? 200,
          headers,
          json: async () => body,
        } as unknown as Response
      },
    },
  }
})

const KEY = "test-admin-api-key"

function postReq(headers: Record<string, string>, body: unknown) {
  return new Request("http://localhost/api/admin/xp-multiplier", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

function delReq(headers: Record<string, string>) {
  return new Request("http://localhost/api/admin/xp-multiplier", { method: "DELETE", headers })
}

const VALID_BODY = { multiplier: 2, durationMs: 60_000, reason: "test boost" }

describe("admin/xp-multiplier route auth", () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env.ADMIN_API_KEY
    process.env.ADMIN_API_KEY = KEY
    clearXPMultiplier()
  })

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_API_KEY
    else process.env.ADMIN_API_KEY = original
    clearXPMultiplier()
  })

  it("POST without x-admin-key is rejected with 401", async () => {
    const res = await POST(postReq({ "content-type": "application/json" }, VALID_BODY))
    expect(res.status).toBe(401)
    expect((await res.json() as { ok: boolean }).ok).toBe(false)
  })

  it("POST with a wrong key is rejected with 401", async () => {
    const res = await POST(postReq({ "x-admin-key": "nope" }, VALID_BODY))
    expect(res.status).toBe(401)
  })

  it("POST with the correct key succeeds", async () => {
    const res = await POST(postReq({ "x-admin-key": KEY }, VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; multiplier: number }
    expect(body.ok).toBe(true)
    expect(body.multiplier).toBe(2)
  })

  it("DELETE without x-admin-key is rejected with 401", async () => {
    const res = await DELETE(delReq({}))
    expect(res.status).toBe(401)
  })

  it("DELETE with the correct key succeeds", async () => {
    const res = await DELETE(delReq({ "x-admin-key": KEY }))
    expect(res.status).toBe(200)
  })
})
