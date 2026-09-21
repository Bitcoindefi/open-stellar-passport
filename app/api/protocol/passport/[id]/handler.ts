import { NextResponse } from "next/server"
import { executeSuspensionRoute, type SuspensionAction } from "@/lib/passport/suspension"

export interface RouteContext {
  params: Promise<{ id: string }>
}

export async function handleSuspensionPost(
  req: Request,
  context: RouteContext,
  action: SuspensionAction,
): Promise<NextResponse> {
  const result = await executeSuspensionRoute(req, context, action)
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  })
}
