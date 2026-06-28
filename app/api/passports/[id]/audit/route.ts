import { NextResponse } from "next/server"
import { listAuditEntries } from "@/lib/passport/audit"
import { getPassport } from "@/lib/passport/passport"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const passportId = decodeURIComponent(id)

    // Check if the passport exists
    const passport = getPassport(passportId)
    if (!passport) {
      return NextResponse.json(
        { ok: false, error: "passport_not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      )
    }

    const entries = listAuditEntries(passportId)
    return NextResponse.json(
      {
        passportId,
        entries,
        total: entries.length,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch audit log" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
