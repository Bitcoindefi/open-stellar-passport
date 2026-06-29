import { Router, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import Appeal from "../models/Appeal";
import Passport from "../models/Passport";
import { emitAudit } from "../services/audit";
import { AuthRequest, requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

/**
 * POST /api/passports/:id/appeal
 * Submit an appeal for a suspended passport.
 */
router.post(
  "/api/passports/:id/appeal",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const passportId = req.params.id;
      const { reason } = req.body;
      const agentId = req.user!.agentId;

      // Validate reason
      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({ error: "Reason is required" });
        return;
      }
      if (reason.length > 1000) {
        res
          .status(400)
          .json({ error: "Reason must not exceed 1000 characters" });
        return;
      }

      // Fetch passport
      const passport = await Passport.findOne({ passportId });
      if (!passport) {
        res.status(404).json({ error: "Passport not found" });
        return;
      }

      // Only holder can submit
      if (passport.agentId !== agentId) {
        res
          .status(403)
          .json({ error: "Only the passport holder can submit an appeal" });
        return;
      }

      // Must be suspended
      if (passport.status !== "suspended") {
        res.status(422).json({ error: "Passport is not suspended" });
        return;
      }

      // Check for existing pending appeal (409 guard)
      const existingPending = await Appeal.findOne({
        passportId,
        status: "pending",
      });
      if (existingPending) {
        res
          .status(409)
          .json({ error: "An appeal is already pending for this passport" });
        return;
      }

      // Create appeal
      const appeal = await Appeal.create({
        appealId: uuidv4(),
        passportId,
        agentId,
        reason: reason.trim(),
        status: "pending",
        submittedAt: new Date(),
      });

      await emitAudit({
        action: "appeal_submitted",
        actor: agentId,
        target: passportId,
        reason: appeal.reason,
      });

      res.status(201).json({
        appealId: appeal.appealId,
        status: appeal.status,
        submittedAt: appeal.submittedAt,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * GET /api/passports/:id/appeal
 * Returns current appeal status for a passport.
 */
router.get(
  "/api/passports/:id/appeal",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const passportId = req.params.id;
      const agentId = req.user!.agentId;

      const passport = await Passport.findOne({ passportId });
      if (!passport) {
        res.status(404).json({ error: "Passport not found" });
        return;
      }

      // Only holder can view their own appeal
      if (passport.agentId !== agentId && req.user!.role !== "admin") {
        res
          .status(403)
          .json({ error: "Only the passport holder can view this appeal" });
        return;
      }

      const appeal = await Appeal.findOne({ passportId }).sort({
        submittedAt: -1,
      });
      if (!appeal) {
        res.status(404).json({ error: "No appeal found for this passport" });
        return;
      }

      res.json({
        status: appeal.status,
        reason: appeal.reason,
        reviewedBy: appeal.reviewedBy,
        reviewedAt: appeal.reviewedAt,
        note: appeal.note,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * PATCH /api/admin/appeals/:appealId
 * Admin review: approve or reject an appeal.
 */
router.patch(
  "/api/admin/appeals/:appealId",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    try {
      const { appealId } = req.params;
      const { decision, note } = req.body;
      const adminId = req.user!.agentId;

      if (!decision || !["approved", "rejected"].includes(decision)) {
        res
          .status(400)
          .json({ error: "Decision must be 'approved' or 'rejected'" });
        return;
      }

      const appeal = await Appeal.findOne({ appealId, status: "pending" });
      if (!appeal) {
        res.status(404).json({ error: "Pending appeal not found" });
        return;
      }

      appeal.status = decision;
      appeal.reviewedBy = adminId;
      appeal.reviewedAt = new Date();
      if (note) appeal.note = note;
      await appeal.save();

      const passport = await Passport.findOne({ passportId: appeal.passportId });
      if (!passport) {
        res.status(404).json({ error: "Passport not found" });
        return;
      }

      if (decision === "approved") {
        passport.status = "active";
        await passport.save();

        await emitAudit({
          action: "passport_reactivated",
          actor: adminId,
          target: appeal.passportId,
          reason: "Appeal approved",
          note: note || undefined,
        });
      } else {
        await emitAudit({
          action: "appeal_rejected",
          actor: adminId,
          target: appeal.passportId,
          reason: "Appeal rejected",
          note: note || undefined,
        });
      }

      res.json({
        appealId: appeal.appealId,
        status: appeal.status,
        reviewedBy: appeal.reviewedBy,
        reviewedAt: appeal.reviewedAt,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;