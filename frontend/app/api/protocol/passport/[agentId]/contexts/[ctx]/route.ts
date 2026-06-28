import { NextResponse } from "next/server";
import {
  globalPassportStore,
  isValidServiceContext,
} from "../../../../../../../src/lib/passport-store";

interface RouteContext {
  params: Promise<{ agentId: string; ctx: string }>;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { agentId: encodedAgentId, ctx: encodedContext } = await params;
  const agentId = decodeURIComponent(encodedAgentId);
  const serviceContext = decodeURIComponent(encodedContext).trim();

  if (!isValidServiceContext(serviceContext)) {
    return NextResponse.json(
      { ok: false, error: "invalid_service_context" },
      { status: 400 },
    );
  }

  const passport = globalPassportStore.getPassport(agentId, serviceContext);
  if (!passport) {
    return NextResponse.json(
      { ok: false, error: "passport_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json(passport);
}
