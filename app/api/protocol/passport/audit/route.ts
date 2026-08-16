// app/api/protocol/passport/audit/route.ts
import { NextResponse } from "next/server"
import { listAuditEvents } from "@/lib/passport/audit-log"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const agentId = searchParams.get("agentId")
  if (!agentId || typeof agentId !== "string" || !agentId.trim()) {
    return NextResponse.json(
      { ok: false, error: "agentId is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  const rawLimit = searchParams.get("limit")
  const limit = rawLimit ? parseInt(rawLimit, 10) : 50
  if (!Number.isFinite(limit) || limit < 1) {
    return NextResponse.json(
      { ok: false, error: "limit must be a positive integer" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    )
  }

  const events = listAuditEvents({ agentId, limit })

  return NextResponse.json(
    { ok: true, agentId, events },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  )
}