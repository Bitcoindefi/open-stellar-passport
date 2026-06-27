import { NextResponse } from "next/server"
import { issuePassport, type PassportConfig } from "@/lib/passport/passport"
import { appendAdminAuditEntry } from "@/lib/passport/audit-log"

const DEFAULT_TTL_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DATE_MS = 8_640_000_000_000_000

interface IssuanceBody {
  id?: unknown
  agentId?: unknown
  config?: unknown
  expiresAt?: unknown
}

function defaultExpiresAt(now: number): string {
  const rawTtlDays = process.env.PASSPORT_DEFAULT_TTL_DAYS ?? String(DEFAULT_TTL_DAYS)
  const parsedTtlDays = Number(rawTtlDays)
  const ttlDays = Number.isSafeInteger(parsedTtlDays)
    && parsedTtlDays > 0
    && now + parsedTtlDays * DAY_MS <= MAX_DATE_MS
    ? parsedTtlDays
    : DEFAULT_TTL_DAYS

  return new Date(now + ttlDays * DAY_MS).toISOString()
}

function validateConfig(config: unknown): PassportConfig | null {
  if (config === undefined) return { allowTransfer: true }
  if (
    typeof config !== "object"
    || config === null
    || typeof (config as { allowTransfer?: unknown }).allowTransfer !== "boolean"
  ) {
    return null
  }
  return { allowTransfer: (config as { allowTransfer: boolean }).allowTransfer }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as IssuanceBody

    if (typeof body.id !== "string" || !body.id.trim()) {
      return NextResponse.json(
        { ok: false, error: "id is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (typeof body.agentId !== "string" || !body.agentId.trim()) {
      return NextResponse.json(
        { ok: false, error: "agentId is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const config = validateConfig(body.config)
    if (!config) {
      return NextResponse.json(
        { ok: false, error: "config.allowTransfer must be a boolean" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const now = Date.now()
    let expiresAt: string
    if (body.expiresAt === undefined) {
      expiresAt = defaultExpiresAt(now)
    } else if (
      typeof body.expiresAt !== "string"
      || !Number.isFinite(Date.parse(body.expiresAt))
      || Date.parse(body.expiresAt) <= now
    ) {
      return NextResponse.json(
        { ok: false, error: "expiresAt must be a valid future timestamp" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    } else {
      expiresAt = body.expiresAt
    }

    const actor = req.headers.get("x-stellar-address") || "admin"
    const passport = issuePassport(body.id, body.agentId, actor, config, expiresAt)

    appendAdminAuditEntry({
      action: "grant",
      actor,
      target: body.id,
      metadata: { agentId: body.agentId },
    })

    return NextResponse.json(
      passport,
      { status: 201, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to issue passport" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
