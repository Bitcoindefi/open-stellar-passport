import { NextResponse } from "next/server"
import { expireQuests } from "@/lib/quests/quest-expiry"

export async function GET() {
  try {
    const result = expireQuests()

    return NextResponse.json(
      {
        ok: true,
        expired: result.expired,
        notified: result.notified,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to process quest expiry",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    )
  }
}
