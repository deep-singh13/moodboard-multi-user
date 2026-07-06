import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// This app instance is created fresh with NODE_ENV forced to "production" so
// the session cookie is configured with `secure: true` (see lib/session.ts),
// matching how the app actually runs in deployment. Requests below simulate
// a TLS-terminating reverse proxy (Render, Heroku, etc.) by sending
// `X-Forwarded-Proto: https` on an otherwise-plain-HTTP connection.

const TEST_EMAIL_DOMAIN = "@trust-proxy-test.example.com";

let app: Express;
let db: typeof import("./lib/db");

async function cleanup() {
  await db.pool.query(
    "DELETE FROM items WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)",
    [`%${TEST_EMAIL_DOMAIN}`],
  );
  await db.pool.query("DELETE FROM users WHERE email LIKE $1", [`%${TEST_EMAIL_DOMAIN}`]);
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();

  db = await import("./lib/db");
  await db.initDb();

  const appModule = await import("./app");
  app = appModule.default;

  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await db.pool.end();
  vi.unstubAllEnvs();
});

describe("session cookie behind a reverse proxy (NODE_ENV=production)", () => {
  it("sets and persists a secure session cookie when the proxy reports HTTPS", async () => {
    const email = `alice${TEST_EMAIL_DOMAIN}`;

    // Not using request.agent()/its automatic cookie jar here: supertest's
    // transport is plain HTTP under the hood, so a real cookie jar correctly
    // refuses to resend a `Secure`-flagged cookie over it (as a real browser
    // would over a genuinely non-HTTPS connection). That client-side jar
    // policy is unrelated to the server-side bug this test targets, so the
    // cookie is forwarded manually to isolate what we're actually verifying:
    // does the server set the cookie, and does it recognize a session
    // presenting that cookie value on a later request.
    const signupRes = await request(app)
      .post("/api/auth/signup")
      .set("X-Forwarded-Proto", "https")
      .send({ email, password: "correct-horse" });

    expect(signupRes.status).toBe(201);
    const setCookieHeader = signupRes.headers["set-cookie"];
    expect(setCookieHeader).toBeDefined();
    const sessionCookie = setCookieHeader![0].split(";")[0];

    const meRes = await request(app)
      .get("/api/auth/me")
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", sessionCookie);

    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe(email);
  });
});
