import { NextRequest, NextResponse } from "next/server";
import { revokePassport, isRevoked } from "../../../../../src/lib/passport/revocation-store";
import { globalPassportStore } from "../../../../../src/lib/passport-store";

export const auditLog: any[] = [];

/**
 * POST /api/protocol/passport/revoke-bulk
 *
 * Body: { agentIds: string[], reason?: string }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ ok: false, reason: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "MissingFields" }, { status: 400 });
  }

  const { agentIds } = body ?? {};
  if (!Array.isArray(agentIds)) {
    return NextResponse.json({ ok: false, reason: "MissingFields" }, { status: 400 });
  }

  if (agentIds.length > 50) {
    return NextResponse.json({ ok: false, reason: "TooManyAgents" }, { status: 400 });
  }

  const revoked: string[] = [];
  const notFound: string[] = [];
  const alreadyRevoked: string[] = [];

  for (const id of agentIds) {
    if (typeof id !== "string") continue;
    const agentId = id.trim();

    const passport = globalPassportStore.getPassport(agentId);
    if (!passport) {
      notFound.push(agentId);
      continue;
    }

    if (isRevoked(agentId)) {
      alreadyRevoked.push(agentId);
      continue;
    }

    revokePassport(agentId);
    revoked.push(agentId);

    // Each revocation records an AuditRecord with action=Symbol::new('bulk_revoke')
    auditLog.push({
      action: Symbol.for("bulk_revoke"),
      agentId,
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json({ revoked, notFound, alreadyRevoked });
}
