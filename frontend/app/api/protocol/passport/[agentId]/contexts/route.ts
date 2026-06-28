import { NextResponse } from "next/server";
import { globalPassportStore } from "../../../../../../src/lib/passport-store";

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { agentId: encodedAgentId } = await params;
  const agentId = decodeURIComponent(encodedAgentId);
  const passports = globalPassportStore.listPassports(agentId);

  return NextResponse.json({
    agentId,
    passports,
    contexts: passports.map((passport) => passport.serviceContext),
  });
}
