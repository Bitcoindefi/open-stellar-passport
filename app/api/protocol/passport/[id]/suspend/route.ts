import { handleSuspensionPost, type RouteContext } from "../handler"

export async function POST(req: Request, context: RouteContext) {
  return handleSuspensionPost(req, context, "suspend")
}
