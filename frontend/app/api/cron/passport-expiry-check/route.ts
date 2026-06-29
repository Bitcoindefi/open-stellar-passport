import { NextResponse } from "next/server";
import { globalPassportStore } from "../../../../src/lib/passport-store";
import { addNotification } from "../../../../src/lib/notifications/notification-store";

const warnedSet = new Set<string>();

/**
 * GET /api/cron/passport-expiry-check
 *
 * Runs daily. Finds passports expiring within WARN_DAYS_BEFORE and emits
 * a passport.expiring_soon notification for each — at most once per day.
 */
export async function GET() {
  const WARN_DAYS_BEFORE = parseInt(
    (typeof process !== "undefined" && process.env.WARN_DAYS_BEFORE) || "3"
  );
  
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const warningCutoff = now + WARN_DAYS_BEFORE * ONE_DAY_MS;

  const allPassports = globalPassportStore.getAllPassports();
  
  const expiringPassports = allPassports.filter((p) => {
    const expiresAt = new Date(p.expiresAt).getTime();
    return expiresAt > now && expiresAt <= warningCutoff;
  });

  const checked = allPassports.length;
  let warned = 0;
  
  const dateStr = new Date(now).toISOString().split("T")[0];

  for (const passport of expiringPassports) {
    const dedupeKey = `passport_expiry_${passport.agentId}_${dateStr}`;
    if (warnedSet.has(dedupeKey)) {
      continue;
    }

    const expiresAtMs = new Date(passport.expiresAt).getTime();
    const daysRemaining = Math.ceil((expiresAtMs - now) / ONE_DAY_MS);

    addNotification(passport.agentId, {
      title: "passport.expiring_soon",
      message: JSON.stringify({
        agentId: passport.agentId,
        expiresAt: passport.expiresAt,
        daysRemaining,
      }),
    });

    warnedSet.add(dedupeKey);
    warned++;
  }

  return NextResponse.json({ checked, warned });
}

export function _resetWarnedSet() {
  warnedSet.clear();
}
