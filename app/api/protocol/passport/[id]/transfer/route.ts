import { NextResponse } from "next/server"
import {
  validateTransferInput,
  transferPassport,
  buildTransferWebhookPayload,
  type TransferRecord,
} from "@/lib/passport/transfer"
import { getPassport, isPassportTransferable } from "@/lib/passport/passport"
import { appendAdminAuditEntry } from "@/lib/passport/audit-log"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const passportId = decodeURIComponent(id)
    const body = await req.json().catch(() => ({}))

    const callerAddress = req.headers.get("x-stellar-address")
    if (!callerAddress) {
      return NextResponse.json(
        { ok: false, error: "x-stellar-address header is required" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      )
    }

    const passport = getPassport(passportId)
    if (!passport) {
      return NextResponse.json(
        { ok: false, error: "passport_not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (passport.agentId !== callerAddress) {
      return NextResponse.json(
        { ok: false, error: "not_passport_holder" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      )
    }

    const transferable = isPassportTransferable(passportId)
    if (!transferable.ok) {
      const status = transferable.error === "transfer_not_allowed" ? 403 : 400
      return NextResponse.json(
        { ok: false, error: transferable.error },
        { status, headers: { "Cache-Control": "no-store" } },
      )
    }

    const validation = validateTransferInput(body)
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: validation.error },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (callerAddress === validation.input.newOwnerAddress) {
      return NextResponse.json(
        { ok: false, error: "transfer_to_self" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const record: TransferRecord = transferPassport(passportId, callerAddress, validation.input)

    appendAdminAuditEntry({
      action: "admin_transfer",
      actor: callerAddress,
      target: validation.input.newOwnerAddress,
      metadata: { passportId },
    })

    const webhookPayload = buildTransferWebhookPayload(record)

    return NextResponse.json(
      {
        ok: true,
        transfer: {
          passportId: record.passportId,
          fromAddress: record.fromAddress,
          toAddress: record.toAddress,
          reason: record.reason,
          transferredAt: record.transferredAt,
        },
        webhookPayload,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to transfer passport"

    if (message === "transfer_to_self" || message === "passport_revoked" || message === "passport_expired" || message === "passport_suspended") {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (message === "transfer_not_allowed") {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (message === "not_passport_holder") {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      )
    }

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
