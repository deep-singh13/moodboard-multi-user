import type { Request, Response, NextFunction } from "express";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    userEmail?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const { userId, userEmail } = req.session;
  if (!userId || !userEmail) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = { id: userId, email: userEmail };
  next();
}
