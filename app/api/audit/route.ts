import { NextRequest, NextResponse } from "next/server"
import { listAuditEntriesByActor } from "@/lib/passport/audit"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const actor = searchParams.get("actor")

    if (!actor) {
      return NextResponse.json(
        { ok: false, error: "actor query parameter is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      )
    }

    const entries = listAuditEntriesByActor(actor)
    return NextResponse.json(
      {
        actor,
        entries,
        total: entries.length,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch audit log by actor" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
