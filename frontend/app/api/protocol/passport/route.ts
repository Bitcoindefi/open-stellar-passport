import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_SERVICE_CONTEXT,
  globalPassportStore,
  isValidServiceContext,
} from "../../../../src/lib/passport-store";
import { checkRateLimit } from "../../../../src/lib/rate-limit";
import { ISSUANCE_LIMIT } from "../../../../src/lib/passport/issuance-rate-limit";

function parseServiceContext(
  value: unknown,
): { ok: true; serviceContext: string } | { ok: false } {
  if (value == null) {
    return { ok: true, serviceContext: DEFAULT_SERVICE_CONTEXT };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const serviceContext = value.trim();
  if (!isValidServiceContext(serviceContext)) {
    return { ok: false };
  }

  return { ok: true, serviceContext };
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { allowed, retryAfterSeconds } = checkRateLimit(
    `passport:issue:${ip}`,
    ISSUANCE_LIMIT,
  );

  if (!allowed) {
    return NextResponse.json(
      { ok: false },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsedBody: unknown = await request.json();
    if (
      typeof parsedBody !== "object" ||
      parsedBody === null ||
      Array.isArray(parsedBody)
    ) {
      return NextResponse.json(
        { ok: false, reason: "MissingFields" },
        { status: 400 },
      );
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "MissingFields" },
      { status: 400 },
    );
  }

  const agentId = body.agentId;
  const spendCapXlm = body.spendCapXlm;
  const zkProofHash = body.zkProofHash;
  const ttlDays = body.ttlDays;
  const issuer = body.issuer;
  const serviceContext = body.serviceContext;

  if (
    typeof agentId !== "string" ||
    agentId.trim() === "" ||
    typeof spendCapXlm !== "number" ||
    !Number.isFinite(spendCapXlm) ||
    spendCapXlm < 0 ||
    typeof zkProofHash !== "string" ||
    zkProofHash.trim() === ""
  ) {
    return NextResponse.json(
      { ok: false, reason: "MissingFields" },
      { status: 400 },
    );
  }

  if (
    ttlDays != null &&
    (typeof ttlDays !== "number" || !Number.isInteger(ttlDays) || ttlDays <= 0)
  ) {
    return NextResponse.json(
      { ok: false, reason: "InvalidTtlDays" },
      { status: 400 },
    );
  }

  if (issuer != null && typeof issuer !== "string") {
    return NextResponse.json(
      { ok: false, reason: "MissingFields" },
      { status: 400 },
    );
  }

  const normalizedTtlDays = typeof ttlDays === "number" ? ttlDays : undefined;
  const normalizedIssuer = typeof issuer === "string" ? issuer : undefined;

  const parsedContext = parseServiceContext(serviceContext);
  if (!parsedContext.ok) {
    return NextResponse.json(
      { ok: false, reason: "InvalidServiceContext" },
      { status: 400 },
    );
  }

  const passport = globalPassportStore.issuePassport(
    agentId.trim(),
    spendCapXlm,
    zkProofHash.trim(),
    normalizedTtlDays,
    normalizedIssuer,
    parsedContext.serviceContext,
  );

  return NextResponse.json({ ok: true, passport }, { status: 201 });
}
