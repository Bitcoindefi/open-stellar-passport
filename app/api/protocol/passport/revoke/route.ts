// app/api/protocol/passport/revoke/route.ts
import { NextResponse } from "next/server"
import { revokePassport } from "@/lib/passport/passport"

interface RevokeBody {
  id?: unknown
  reason?: unknown
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as RevokeBody

    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json(
        { ok: false, error: "id is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const actor = req.headers.get("x-stellar-address") || "admin"
    const reason = typeof body.reason === "string" ? body.reason : undefined

    const record = revokePassport(body.id, actor, reason)

    return NextResponse.json(
      { ok: true, passport: record },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to revoke passport"
    const status = message === "passport_not_found" ? 404 : 500
    return NextResponse.json(
      { ok: false, error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    )
  }
}