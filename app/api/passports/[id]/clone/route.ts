import { NextResponse } from "next/server"
import { clonePassport, getPassport } from "@/lib/passport/passport"

interface RouteContext {
  params: Promise<{ id: string }>
}

function isAdmin(req: Request): boolean {
  const adminKey = req.headers.get("x-admin-key")
  return !!adminKey && adminKey === process.env.ADMIN_API_KEY
}

export async function POST(req: Request, context: RouteContext) {
  if (!isAdmin(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    )
  }

  try {
    const { id } = await context.params
    const passportId = decodeURIComponent(id)

    const source = getPassport(passportId)
    if (!source) {
      return NextResponse.json(
        { ok: false, error: "passport_not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      )
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const actor = req.headers.get("x-stellar-address") || "admin"

    const targetId = typeof body.id === "string" && body.id.trim()
      ? body.id.trim()
      : (typeof body.newId === "string" && body.newId.trim() ? body.newId.trim() : undefined)

    const agentId = typeof body.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim()
      : undefined

    const reason = typeof body.reason === "string" ? body.reason : undefined

    const cloned = clonePassport(passportId, agentId, actor, reason, {
      newId: targetId,
    })

    return NextResponse.json(
      cloned,
      { status: 201, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to clone passport"
    if (message === "passport_not_found") {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      )
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
