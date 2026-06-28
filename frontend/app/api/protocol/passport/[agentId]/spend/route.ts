import { NextRequest, NextResponse } from "next/server";
import { globalPassportStore } from "../../../../../../src/lib/passport-store";

type RouteContext = {
  params: Promise<{ agentId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { agentId: encodedAgentId } = await params;
  const agentId = decodeURIComponent(encodedAgentId);
  const callerAddress = request.headers.get("x-stellar-address");

  if (callerAddress !== agentId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const analytics = globalPassportStore.getSpendAnalytics(agentId);
  if (!analytics) {
    return NextResponse.json(
      { ok: false, error: "passport_not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json(analytics);
}
