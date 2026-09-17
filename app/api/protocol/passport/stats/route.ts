import { NextResponse } from "next/server"
import { getPassportStats } from "@/lib/passport/stats"

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const expiringSoonDaysParam = url.searchParams.get("expiringSoonDays")
    const expiringSoonDays = expiringSoonDaysParam ? Number(expiringSoonDaysParam) : undefined

    const stats = getPassportStats({
      expiringSoonDays:
        Number.isFinite(expiringSoonDays) && (expiringSoonDays as number) > 0
          ? expiringSoonDays
          : undefined,
    })

    return NextResponse.json(stats, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "internal_server_error",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }
}
