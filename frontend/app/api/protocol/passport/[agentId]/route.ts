import { NextResponse } from "next/server";
import { globalPassportStore } from "../../../../../src/lib/passport-store";

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { agentId: encodedAgentId } = await params;
  const agentId = decodeURIComponent(encodedAgentId);
  const passport = globalPassportStore.getPassport(agentId);

  if (!passport) {
    return NextResponse.json(
      { ok: false, error: "passport_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json(passport);
}
