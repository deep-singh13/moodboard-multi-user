import session from "express-session";
import type { RequestHandler } from "express";
import createPgSessionStore from "connect-pg-simple";
import { pool } from "./db";

const PgSessionStore = createPgSessionStore(session);

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createSessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is required but was not provided.",
    );
  }

  return session({
    store: new PgSessionStore({
      pool,
      tableName: "sessions",
      createTableIfMissing: false,
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_MAX_AGE_MS,
    },
  });
}
