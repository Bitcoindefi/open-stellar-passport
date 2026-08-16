// app/api/protocol/passport/authorize/route.ts
import { NextResponse } from "next/server"
import { authorizePassportSpend } from "@/lib/passport/passport"

interface AuthorizeBody {
  agentId?: unknown
  amount?: unknown
  quoteId?: unknown
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as AuthorizeBody

    if (typeof body.agentId !== "string" || !body.agentId.trim()) {
      return NextResponse.json(
        { ok: false, error: "agentId is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
      return NextResponse.json(
        { ok: false, error: "amount must be a positive number" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (typeof body.quoteId !== "string" || !body.quoteId.trim()) {
      return NextResponse.json(
        { ok: false, error: "quoteId is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const actor = req.headers.get("x-stellar-address") || "admin"
    const result = authorizePassportSpend(body.agentId, body.amount, body.quoteId, actor)

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      )
    }

    return NextResponse.json(
      { ok: true, passport: result.record },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to authorize spend" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}