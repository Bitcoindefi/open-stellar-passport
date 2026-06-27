import { NextResponse } from "next/server"
import {
  setXPMultiplier,
  clearXPMultiplier,
  getActiveMultiplierInfo,
} from "@/lib/gamification/xp-multiplier"

const MAX_MULTIPLIER = 10
const MIN_MULTIPLIER = 1
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Request body must be an object with { multiplier, durationMs, reason }" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const { multiplier, durationMs, reason } = body as Record<string, unknown>

    if (typeof multiplier !== "number" || !Number.isInteger(multiplier)) {
      return NextResponse.json(
        { ok: false, error: "multiplier must be an integer" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (multiplier < MIN_MULTIPLIER || multiplier > MAX_MULTIPLIER) {
      return NextResponse.json(
        { ok: false, error: `multiplier must be between ${MIN_MULTIPLIER} and ${MAX_MULTIPLIER}` },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
      return NextResponse.json(
        { ok: false, error: "durationMs must be a positive number" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (durationMs > MAX_DURATION_MS) {
      return NextResponse.json(
        { ok: false, error: `durationMs cannot exceed ${MAX_DURATION_MS}ms (7 days)` },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    if (typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json(
        { ok: false, error: "reason must be a non-empty string" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      )
    }

    const validUntil = Date.now() + durationMs

    setXPMultiplier({
      multiplier,
      validUntil,
      reason: reason.trim().slice(0, 500),
    })

    return NextResponse.json(
      {
        ok: true,
        active: true,
        multiplier,
        validUntil,
        reason: reason.trim().slice(0, 500),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to set XP multiplier",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}

export async function DELETE() {
  try {
    clearXPMultiplier()

    return NextResponse.json(
      {
        ok: true,
        active: false,
        multiplier: 1,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to clear XP multiplier",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
