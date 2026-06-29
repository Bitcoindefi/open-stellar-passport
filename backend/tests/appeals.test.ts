import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../src/app";
import Passport from "../src/models/Passport";
import Appeal from "../src/models/Appeal";
import { getAuditLog } from "../src/services/audit";

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Passport.deleteMany({});
  await Appeal.deleteMany({});
});

// Helper to seed a passport
async function seedPassport(
  overrides: Partial<{ status: string; agentId: string }> = {}
) {
  return Passport.create({
    passportId: "pp-test-001",
    agentId: "agent-42",
    status: "active",
    ...overrides,
  });
}

// Helper to auth as holder or admin
function authHeader(role: "agent" | "admin" = "agent", agentId = "agent-42") {
  return {
    Authorization: "Bearer test-token",
    "x-agent-id": agentId,
    "x-role": role,
  };
}

// Monkey-patch middleware for tests to read x-role header
jest.mock("../src/middleware/auth", () => {
  const actual = jest.requireActual("../src/middleware/auth");
  return {
    ...actual,
    requireAuth: (req: any, res: any, next: any) => {
      req.user = {
        agentId: req.headers["x-agent-id"] || "agent-42",
        role: req.headers["x-role"] || "agent",
      };
      next();
    },
    requireAdmin: (req: any, res: any, next: any) => {
      req.user = {
        agentId: req.headers["x-agent-id"] || "admin-1",
        role: req.headers["x-role"] || "admin",
      };
      if (req.user.role !== "admin") {
        res.status(403).json({ error: "Forbidden: admin only" });
        return;
      }
      next();
    },
  };
});

describe("POST /api/passports/:id/appeal", () => {
  it("creates an appeal with pending status for a suspended passport", async () => {
    await seedPassport({ status: "suspended" });

    const res = await request(app)
      .post("/api/passports/pp-test-001/appeal")
      .set(authHeader())
      .send({ reason: "I believe this suspension was incorrect." });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.appealId).toBeDefined();
    expect(res.body.submittedAt).toBeDefined();

    const audit = getAuditLog().find((e) => e.action === "appeal_submitted");
    expect(audit).toBeDefined();
    expect(audit!.actor).toBe("agent-42");
    expect(audit!.reason).toBe("I believe this suspension was incorrect.");
  });

  it("returns 403 when a non-holder tries to submit an appeal", async () => {
    await seedPassport({ status: "suspended" });

    const res = await request(app)
      .post("/api/passports/pp-test-001/appeal")
      .set(authHeader("agent", "agent-99"))
      .send({ reason: "I want to appeal this." });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Only the passport holder/);
  });

  it("returns 409 if an appeal is already pending", async () => {
    await seedPassport({ status: "suspended" });
    await Appeal.create({
      appealId: "app-001",
      passportId: "pp-test-001",
      agentId: "agent-42",
      reason: "First appeal",
      status: "pending",
    });

    const res = await request(app)
      .post("/api/passports/pp-test-001/appeal")
      .set(authHeader())
      .send({ reason: "Second appeal" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already pending/);
  });

  it("returns 422 if passport is not suspended", async () => {
    await seedPassport({ status: "active" });

    const res = await request(app)
      .post("/api/passports/pp-test-001/appeal")
      .set(authHeader())
      .send({ reason: "I want to appeal anyway." });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not suspended/);
  });

  it("returns 400 for missing or too-long reason", async () => {
    await seedPassport({ status: "suspended" });

    const missing = await request(app)
      .post("/api/passports/pp-test-001/appeal")
      .set(authHeader())
      .send({});
    expect(missing.status).toBe(400);

    const tooLong = await request(app)
      .post("/api/passports/pp-test-001/appeal")
      .set(authHeader())
      .send({ reason: "x".repeat(1001) });
    expect(tooLong.status).toBe(400);
  });
});

describe("GET /api/passports/:id/appeal", () => {
  it("returns current appeal status for the holder", async () => {
    await seedPassport({ status: "suspended" });
    await Appeal.create({
      appealId: "app-001",
      passportId: "pp-test-001",
      agentId: "agent-42",
      reason: "Please review.",
      status: "pending",
    });

    const res = await request(app)
      .get("/api/passports/pp-test-001/appeal")
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect(res.body.reason).toBe("Please review.");
  });
});

describe("PATCH /api/admin/appeals/:appealId", () => {
  it("approves appeal and reactivates passport", async () => {
    await seedPassport({ status: "suspended" });
    await Appeal.create({
      appealId: "app-001",
      passportId: "pp-test-001",
      agentId: "agent-42",
      reason: "Please review.",
      status: "pending",
    });

    const res = await request(app)
      .patch("/api/admin/appeals/app-001")
      .set(authHeader("admin", "admin-1"))
      .send({ decision: "approved", note: "Looks good." });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");

    const passport = await Passport.findOne({ passportId: "pp-test-001" });
    expect(passport!.status).toBe("active");

    const audit = getAuditLog().find(
      (e) => e.action === "passport_reactivated"
    );
    expect(audit).toBeDefined();
    expect(audit!.note).toBe("Looks good.");
  });

  it("rejects appeal and keeps passport suspended", async () => {
    await seedPassport({ status: "suspended" });
    await Appeal.create({
      appealId: "app-002",
      passportId: "pp-test-001",
      agentId: "agent-42",
      reason: "Please review.",
      status: "pending",
    });

    const res = await request(app)
      .patch("/api/admin/appeals/app-002")
      .set(authHeader("admin", "admin-1"))
      .send({ decision: "rejected", note: "Insufficient evidence." });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");

    const passport = await Passport.findOne({ passportId: "pp-test-001" });
    expect(passport!.status).toBe("suspended");

    const audit = getAuditLog().find((e) => e.action === "appeal_rejected");
    expect(audit).toBeDefined();
    expect(audit!.note).toBe("Insufficient evidence.");
  });

  it("returns 403 for non-admin", async () => {
    const res = await request(app)
      .patch("/api/admin/appeals/app-001")
      .set(authHeader("agent", "agent-42"))
      .send({ decision: "approved" });

    expect(res.status).toBe(403);
  });
});

describe("Full appeal lifecycle", () => {
  it("submit → get → approve → verify reactivation", async () => {
    await seedPassport({ status: "suspended" });

    // 1. Submit
    const submitRes = await request(app)
      .post("/api/passports/pp-test-001/appeal")
      .set(authHeader())
      .send({ reason: "I was suspended unfairly." });
    expect(submitRes.status).toBe(201);
    const appealId = submitRes.body.appealId;

    // 2. Get status
    const getRes = await request(app)
      .get("/api/passports/pp-test-001/appeal")
      .set(authHeader());
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("pending");

    // 3. Admin approves
    const patchRes = await request(app)
      .patch(`/api/admin/appeals/${appealId}`)
      .set(authHeader("admin", "admin-1"))
      .send({ decision: "approved" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.status).toBe("approved");

    // 4. Verify passport reactivated
    const passport = await Passport.findOne({ passportId: "pp-test-001" });
    expect(passport!.status).toBe("active");

    // 5. Verify audit trail
    const actions = getAuditLog().map((e) => e.action);
    expect(actions).toContain("appeal_submitted");
    expect(actions).toContain("passport_reactivated");
  });
});