import { NextRequest, NextResponse } from "next/server";
import {
  globalPassportStore,
  PassportRecord,
} from "../../../src/lib/passport-store";
import { isRevoked } from "../../../src/lib/passport/revocation-store";

function getStatus(
  passport: PassportRecord,
): "active" | "suspended" | "revoked" | "expired" {
  if (isRevoked(passport.agentId, passport.serviceContext)) {
    return "revoked";
  }
  if (passport.suspended) {
    return "suspended";
  }
  if (new Date(passport.expiresAt) < new Date()) {
    return "expired";
  }
  return "active";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const agentId = searchParams.get("agentId");
  const status = searchParams.get("status");
  const issuer = searchParams.get("issuer");
  const issuedAfter = searchParams.get("issuedAfter");
  const issuedBefore = searchParams.get("issuedBefore");
  const page = searchParams.get("page");
  const pageSize = searchParams.get("pageSize");
  const sort = searchParams.get("sort");

  let passports = globalPassportStore.getAllPassports();

  // Apply filters
  if (agentId) {
    passports = passports.filter(
      (p) => p.agentId.toLowerCase() === agentId.toLowerCase(),
    );
  }

  if (status) {
    passports = passports.filter((p) => getStatus(p) === status);
  }

  if (issuer) {
    passports = passports.filter(
      (p) => p.issuer?.toLowerCase() === issuer.toLowerCase(),
    );
  }

  if (issuedAfter) {
    const afterDate = new Date(issuedAfter);
    if (!isNaN(afterDate.getTime())) {
      passports = passports.filter((p) => new Date(p.issuedAt) >= afterDate);
    }
  }

  if (issuedBefore) {
    const beforeDate = new Date(issuedBefore);
    if (!isNaN(beforeDate.getTime())) {
      passports = passports.filter((p) => new Date(p.issuedAt) <= beforeDate);
    }
  }

  // Sort
  const sortByStatus = sort === "status";
  passports.sort((a, b) => {
    if (sortByStatus) {
      const statusA = getStatus(a);
      const statusB = getStatus(b);
      if (statusA !== statusB) {
        return statusA.localeCompare(statusB);
      }
    }
    // Default / secondary sort: newest first (issuedAt DESC)
    return new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime();
  });

  // Pagination
  const total = passports.length;
  const pageNum = Math.max(Number(page || 1), 1);
  const sizeNum = Math.min(Math.max(Number(pageSize || 20), 1), 100);

  const startIndex = (pageNum - 1) * sizeNum;
  const paginated = passports.slice(startIndex, startIndex + sizeNum);

  // Return filters metadata
  const activeFilters: Record<string, string> = {};
  if (agentId) activeFilters.agentId = agentId;
  if (status) activeFilters.status = status;
  if (issuer) activeFilters.issuer = issuer;
  if (issuedAfter) activeFilters.issuedAfter = issuedAfter;
  if (issuedBefore) activeFilters.issuedBefore = issuedBefore;

  // Format passports payload in response
  const formattedPassports = paginated.map((p) => ({
    ...p,
    status: getStatus(p),
  }));

  return NextResponse.json(
    {
      passports: formattedPassports,
      total,
      page: pageNum,
      pageSize: sizeNum,
      filters: activeFilters,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
