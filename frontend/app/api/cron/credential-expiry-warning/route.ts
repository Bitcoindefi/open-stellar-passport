import { NextResponse } from "next/server";
import {
  findExpiringSoon,
  getLastWarned,
  setLastWarned,
} from "../../../../src/lib/credential-expiry/credential-expiry-store";
import { addNotification } from "../../../../src/lib/notifications/notification-store";

const WARNING_DAYS = parseInt(
  (typeof process !== "undefined" && process.env.CREDENTIAL_WARNING_DAYS) || "7"
);
const WARNING_DAYS_MS = WARNING_DAYS * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/cron/credential-expiry-warning
 *
 * Runs daily. Finds credentials expiring within WARNING_DAYS and emits
 * a credential.expiring_soon notification for each — at most once per day.
 */
export async function GET() {
  const now = Date.now();
  const warningCutoff = now + WARNING_DAYS_MS;

  const expiring = findExpiringSoon(now, warningCutoff);

  let warned = 0;
  let skipped = 0;

  for (const credential of expiring) {
    const lastWarned = getLastWarned(credential.id);
    if (lastWarned && now - lastWarned.warnedAt < ONE_DAY_MS) {
      skipped++;
      continue;
    }

    const daysRemaining = Math.ceil((credential.expiresAt - now) / ONE_DAY_MS);

    addNotification(credential.passportId, {
      title: "credential.expiring_soon",
      message: JSON.stringify({
        credentialId: credential.id,
        passportId: credential.passportId,
        expiresAt: credential.expiresAt,
        daysRemaining,
      }),
    });

    setLastWarned(credential.id, now);
    warned++;
  }

  return NextResponse.json({ warned, skipped });
}
