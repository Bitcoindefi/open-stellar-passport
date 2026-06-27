import { NextResponse } from "next/server"
import { getAllPassports, expirePassport } from "@/lib/passport/passport"

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const passports = getAllPassports()
    const now = Date.now()
    let expiredCount = 0
    const expiredIds: string[] = []

    for (const passport of passports) {
      if (passport.status === "active") {
        const createdTime = new Date(passport.createdAt).getTime()
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
        if (createdTime + thirtyDaysMs < now) {
          expirePassport(passport.id, "cron", "expired_by_cron_ttl")
          expiredCount++
          expiredIds.push(passport.id)
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        expiredCount,
        expiredIds,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to run expiry cron" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
