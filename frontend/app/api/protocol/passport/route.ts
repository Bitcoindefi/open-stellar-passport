import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "../../../../src/lib/rate-limit";
import { ISSUANCE_LIMIT } from "../../../../src/lib/passport/issuance-rate-limit";
import { registerPassport } from "../../../../src/lib/passport/webhook-store";
import { notifyPassportEvent } from "../../../../src/lib/passport/webhook-notifier";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed, retryAfterSeconds } = checkRateLimit(
    `passport:issue:${ip}`,
    ISSUANCE_LIMIT
  );

  if (!allowed) {
    return NextResponse.json(
      { ok: false },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      }
    );
  }

  let passportId: string = crypto.randomUUID();
  let agentId = "agent-" + Math.floor(Math.random() * 1000);
  let expiresAt = Date.now() + 3600_000;

  try {
    const body = await request.json();
    if (body) {
      if (body.passportId) passportId = String(body.passportId);
      if (body.agentId) agentId = String(body.agentId);
      if (body.expiresAt) expiresAt = Number(body.expiresAt);
    }
  } catch {
    // ignore parsing errors and use defaults
  }

  registerPassport(passportId, agentId, expiresAt);
  await notifyPassportEvent("passport.issued", passportId, agentId);

  return NextResponse.json({ ok: true, passportId, agentId });
}
