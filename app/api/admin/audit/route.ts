import { NextResponse } from "next/server"
import { listAdminAuditEntries, type AdminAuditAction } from "@/lib/passport/audit-log"

const VALID_ACTIONS: AdminAuditAction[] = [
  "grant", "revoke", "batch_verify", "admin_transfer", "verifier_change"
]

export async function GET(req: Request) {
  const adminKey = req.headers.get("x-admin-key")
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get("action") as AdminAuditAction | null
    const actor = url.searchParams.get("actor") || undefined
    const target = url.searchParams.get("target") || undefined
    const since = url.searchParams.get("since") || undefined
    const limitParam = url.searchParams.get("limit")
    const limit = limitParam ? parseInt(limitParam, 10) : undefined

    if (action && !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { ok: false, error: `Invalid action filter. Must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      )
    }

    if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
      return NextResponse.json(
        { ok: false, error: "limit must be a positive integer" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      )
    }

    const entries = listAdminAuditEntries({
      action: action || undefined,
      actor,
      target,
      since,
      limit,
    })

    return NextResponse.json(
      { entries, total: entries.length },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to query admin audit log" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
