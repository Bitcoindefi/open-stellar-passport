import { NextResponse } from "next/server"
import { verifyPassportBatch } from "@/lib/passport/passport"

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any
    const { passportIds } = body ?? {}

    if (!Array.isArray(passportIds) || passportIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "passportIds must be a non-empty array" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      )
    }

    if (passportIds.length > 50) {
      return NextResponse.json(
        { ok: false, error: "Cannot verify more than 50 passport IDs at once" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      )
    }

    const verification = verifyPassportBatch(passportIds)
    return NextResponse.json(verification, { status: 200, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to verify passports batch" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
