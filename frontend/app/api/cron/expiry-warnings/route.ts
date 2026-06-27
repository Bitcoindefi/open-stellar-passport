import { NextResponse } from "next/server";
import { globalPassportStore } from "../../../../src/lib/passport-store";
import { emitWebhook } from "../../../../src/lib/webhooks";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// In-memory store for deduplication
// In a real production app this would be a Redis store or database table
// Maps passport ID -> timestamp of last warning
const warningsStore = new Map<string, number>();

export function _resetWarningsStore() {
  warningsStore.clear();
}

export async function GET() {
  const passports = globalPassportStore.getAllPassports();
  const now = Date.now();

  let checked = 0;
  let warned = 0;
  let skipped = 0;

  for (const passport of passports) {
    checked++;
    const expiresAt = new Date(passport.expiresAt).getTime();
    const msRemaining = expiresAt - now;

    // Skip if already expired
    if (msRemaining <= 0) {
      skipped++;
      continue;
    }

    const daysRemaining = Math.ceil(msRemaining / ONE_DAY_MS);

    // Only warn if <= 7 days
    if (daysRemaining <= 7) {
      const lastWarned = warningsStore.get(passport.agentId);
      
      // Dedupe: check if warned within the last 7 days
      if (!lastWarned || now - lastWarned >= SEVEN_DAYS_MS) {
        // Emit webhook
        await emitWebhook(passport.agentId, "passport.expiring_soon", {
          passportId: passport.agentId, // assuming passportId is same as agentId
          expiresAt: passport.expiresAt,
          daysRemaining,
        });

        warningsStore.set(passport.agentId, now);
        warned++;
      } else {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ checked, warned, skipped });
}
