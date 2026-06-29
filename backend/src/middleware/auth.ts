import { Request, Response, NextFunction } from "express";

export interface AuthRequest extends Request {
  user?: { agentId: string; role: "agent" | "admin" };
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Stub: parse Bearer token into user object
  req.user = {
    agentId: (req as any).headers["x-agent-id"] || "unknown",
    role: "agent",
  };
  next();
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "Forbidden: admin only" });
      return;
    }
    next();
  });
}