import { NextResponse } from "next/server"
import { getPassport, clonePassportWithTtlFromNow } from "@/lib/passport/passport"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const passportId = decodeURIComponent(id)

    // Admin auth required
    const actor = req.headers.get("x-stellar-address")
    if (!actor || actor !== "admin") {
      return NextResponse.json(
        { ok: false, error: "admin_required" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      )
    }

    const source = getPassport(passportId)
    if (!source) {
      return NextResponse.json(
        { ok: false, error: "passport_not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      )
    }

    const cloned = clonePassportWithTtlFromNow(passportId, actor)

    return NextResponse.json(
      cloned,
      { status: 201, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to clone passport" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
