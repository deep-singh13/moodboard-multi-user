import { Router, type IRouter } from "express";
import { createUser, verifyUserPassword } from "../lib/users";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_RE.test(email);
}

function isValidPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

router.post("/auth/signup", async (req, res) => {
  const { email, password } = req.body as { email?: unknown; password?: unknown };

  if (!isValidEmail(email)) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }
  if (!isValidPassword(password)) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }

  try {
    const user = await createUser(email.toLowerCase(), password);
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.status(201).json(user);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email?: unknown; password?: unknown };

  if (!isValidEmail(email) || typeof password !== "string" || password.length === 0) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const user = await verifyUserPassword(email.toLowerCase(), password);
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  req.session.userId = user.id;
  req.session.userEmail = user.email;
  res.json(user);
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to log out" });
      return;
    }
    res.clearCookie("connect.sid", { path: "/" });
    res.json({ ok: true });
  });
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
