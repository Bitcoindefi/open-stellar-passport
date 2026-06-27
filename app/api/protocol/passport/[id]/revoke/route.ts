import { NextResponse } from "next/server"
import {
  revokePassport,
  validateRevocationInput,
  buildRevocationWebhookPayload,
  type RevocationRecord,
} from "@/lib/passport/revocation"
import { appendAdminAuditEntry } from "@/lib/passport/audit-log"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const passportId = decodeURIComponent(id)
    const body = await req.json().catch(() => ({}))

    const validation = validateRevocationInput(body)
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: validation.error },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const actor = req.headers.get("x-stellar-address") || "admin"
    const record: RevocationRecord = revokePassport(passportId, validation.input, actor)

    appendAdminAuditEntry({
      action: "revoke",
      actor,
      target: passportId,
      metadata: { reason: record.reason },
    })

    // Build webhook payload (consumer can dispatch via their event bus)
    const webhookPayload = buildRevocationWebhookPayload(record)

    return NextResponse.json(
      {
        ok: true,
        revoked: {
          passportId: record.passportId,
          reason: record.reason,
          notes: record.notes,
          revokedAt: record.revokedAt,
        },
        webhookPayload,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to revoke passport" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}