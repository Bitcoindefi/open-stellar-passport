import { NextRequest, NextResponse } from "next/server";
import { addSubscription } from "../../../../../src/lib/passport/webhook-store";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, events, secret } = body;

    if (!url || !events || !Array.isArray(events) || !secret) {
      return NextResponse.json(
        { error: "url, events (array), and secret are required" },
        { status: 400 }
      );
    }

    const sub = addSubscription(url, events, secret);
    return NextResponse.json(
      { webhookId: sub.id, secret: sub.secret },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
}
