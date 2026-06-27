import { NextResponse } from "next/server"
import { extendPassport } from "@/lib/passport/passport"

interface RouteContext {
  params: Promise<{ id: string }>
}

interface ExtensionBody {
  additionalDays?: unknown
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const body = (await req.json().catch(() => ({}))) as ExtensionBody
    if (
      typeof body.additionalDays !== "number"
      || !Number.isInteger(body.additionalDays)
      || body.additionalDays < 1
      || body.additionalDays > 30
    ) {
      return NextResponse.json(
        { ok: false, error: "additionalDays must be an integer between 1 and 30" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const { id } = await context.params
    const agentId = decodeURIComponent(id)
    const callerAddress = req.headers.get("x-stellar-address")
    if (!callerAddress || callerAddress !== agentId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      )
    }

    const passport = extendPassport(agentId, body.additionalDays, callerAddress)

    return NextResponse.json(
      passport,
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to extend passport"
    if (message === "passport_not_found") {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      )
    }
    if (message === "passport_revoked") {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      )
    }
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
