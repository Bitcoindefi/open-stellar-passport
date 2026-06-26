import { NextResponse } from "next/server";
import { checkAndExpirePassports } from "../../../../../src/lib/passport/webhook-store";
import { notifyPassportEvent } from "../../../../../src/lib/passport/webhook-notifier";

export async function POST() {
  const expired = checkAndExpirePassports();
  for (const p of expired) {
    await notifyPassportEvent("passport.expired", p.id, p.agentId);
  }
  return NextResponse.json({ ok: true, expiredCount: expired.length });
}
