// app/api/protocol/passport/batch-verify/route.ts
import { NextResponse } from "next/server"
import { verifyPassportBatch } from "@/lib/passport/passport"

interface BatchVerifyBody {
  passportIds?: unknown
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as BatchVerifyBody

    if (!Array.isArray(body.passportIds) || body.passportIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "passportIds must be a non-empty array" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (!body.passportIds.every((id) => typeof id === "string" && id.trim())) {
      return NextResponse.json(
        { ok: false, error: "all passportIds must be non-empty strings" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const result = verifyPassportBatch(body.passportIds)

    return NextResponse.json(
      { ok: true, ...result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to batch verify" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}