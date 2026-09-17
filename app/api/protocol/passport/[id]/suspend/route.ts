import { NextResponse } from "next/server"
import {
  suspendPassport,
  buildSuspensionWebhookPayload,
} from "@/lib/passport/suspension"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const passportId = decodeURIComponent(id)
    const body = await req.json().catch(() => ({}))

    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (!reason) {
      return NextResponse.json(
        { ok: false, error: "Missing required field: 'reason'" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const actor = req.headers.get("x-stellar-address") || "admin"
    const record = suspendPassport(passportId, reason, actor)
    const webhookPayload = buildSuspensionWebhookPayload(record)

    return NextResponse.json(
      {
        ok: true,
        suspended: {
          passportId: record.passportId,
          reason: record.reason,
          suspendedAt: record.suspendedAt,
          status: "suspended",
        },
        webhookPayload,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to suspend passport"
    const status = message === "passport_not_found" ? 404 : message === "cannot_suspend_revoked" ? 400 : 500
    return NextResponse.json(
      { ok: false, error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    )
  }
}
