import { NextRequest, NextResponse } from "next/server";
import { globalPassportStore } from "../../../../../src/lib/passport-store";

export async function GET(_request: NextRequest) {
  const revoked = globalPassportStore.getRevocationList();

  return NextResponse.json(revoked, {
    headers: {
      "Cache-Control": "public, max-age=60",
    },
  });
}
