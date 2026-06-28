import { NextResponse } from "next/server";
import { globalPassportStore } from "../../../../src/lib/passport-store";
import { isRevoked } from "../../../../src/lib/passport/revocation-store";

// Global mock status state for component checks
export let mockChecks = {
  passportStore: "ok" as "ok" | "error",
  webhookDispatch: "ok" as "ok" | "error",
  cronJobs: "ok" as "ok" | "error",
};

// Helper function to update mock status checks in tests
export function setMockChecks(updates: Partial<typeof mockChecks>) {
  mockChecks = { ...mockChecks, ...updates };
}

const startTime = Date.now();

export async function GET() {
  // Determine health status
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";

  if (mockChecks.passportStore === "error") {
    status = "unhealthy";
  } else if (mockChecks.webhookDispatch === "error" || mockChecks.cronJobs === "error") {
    status = "degraded";
  }

  // Determine HTTP status code
  const httpStatus = status === "unhealthy" ? 503 : 200;

  // Retrieve passport metrics from the store
  const passports = globalPassportStore.getAllPassports();
  const passportCount = passports.length;
  const activeCount = passports.filter((p) => {
    const isExpired = new Date(p.expiresAt) < new Date();
    return !isExpired && !isRevoked(p.agentId);
  }).length;

  // Calculate uptime
  const uptimeMs = typeof process !== "undefined" && typeof process.uptime === "function"
    ? Math.floor(process.uptime() * 1000)
    : Date.now() - startTime;

  return NextResponse.json(
    {
      status,
      checks: {
        passportStore: mockChecks.passportStore,
        webhookDispatch: mockChecks.webhookDispatch,
        cronJobs: mockChecks.cronJobs,
      },
      passportCount,
      activeCount,
      uptimeMs,
      timestamp: new Date().toISOString(),
    },
    {
      status: httpStatus,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
