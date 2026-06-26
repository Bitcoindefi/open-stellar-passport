import { NextRequest, NextResponse } from "next/server";
import { getPassport, revokePassport } from "../../../../../../src/lib/passport/webhook-store";
import { notifyPassportEvent } from "../../../../../../src/lib/passport/webhook-notifier";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  const passport = getPassport(id);
  const agentId = passport ? passport.agentId : "unknown-agent";

  revokePassport(id);
  await notifyPassportEvent("passport.revoked", id, agentId);

  return NextResponse.json({ ok: true });
}
