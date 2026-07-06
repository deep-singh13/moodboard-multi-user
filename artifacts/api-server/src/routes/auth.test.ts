import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { pool, initDb } from "../lib/db";

const TEST_EMAIL_DOMAIN = "@auth-route-test.example.com";

async function cleanup() {
  await pool.query(
    "DELETE FROM items WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)",
    [`%${TEST_EMAIL_DOMAIN}`],
  );
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${TEST_EMAIL_DOMAIN}`]);
}

beforeAll(async () => {
  await initDb();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("POST /api/auth/signup", () => {
  it("creates a new account and starts a session", async () => {
    const agent = request.agent(app);
    const email = `alice${TEST_EMAIL_DOMAIN}`;

    const res = await agent.post("/api/auth/signup").send({ email, password: "correct-horse" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(email);
    expect(res.body.id).toBeTypeOf("string");

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it("rejects a duplicate email with 409", async () => {
    const email = `bob${TEST_EMAIL_DOMAIN}`;
    await request(app).post("/api/auth/signup").send({ email, password: "correct-horse" });

    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email, password: "another-password" });
    expect(res.status).toBe(409);
  });

  it("rejects a password under 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: `short${TEST_EMAIL_DOMAIN}`, password: "abc123" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials", async () => {
    const email = `carol${TEST_EMAIL_DOMAIN}`;
    await request(app).post("/api/auth/signup").send({ email, password: "correct-horse" });

    const agent = request.agent(app);
    const res = await agent.post("/api/auth/login").send({ email, password: "correct-horse" });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
  });

  it("rejects an incorrect password", async () => {
    const email = `dave${TEST_EMAIL_DOMAIN}`;
    await request(app).post("/api/auth/signup").send({ email, password: "correct-horse" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/auth/me", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session so /me returns 401 afterward", async () => {
    const email = `erin${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send({ email, password: "correct-horse" });

    const logoutRes = await agent.post("/api/auth/logout");
    expect(logoutRes.status).toBe(200);

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(401);
  });
});

describe("POST /api/auth/change-password", () => {
  it("changes the password when the current password is correct", async () => {
    const email = `frank${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send({ email, password: "correct-horse" });

    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: "correct-horse", newPassword: "new-correct-horse" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "correct-horse" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "new-correct-horse" });
    expect(newLogin.status).toBe(200);
  });

  it("rejects an incorrect current password with 401 and does not change the password", async () => {
    const email = `grace${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send({ email, password: "correct-horse" });

    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: "wrong-password", newPassword: "new-correct-horse" });
    expect(res.status).toBe(401);

    const stillWorks = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "correct-horse" });
    expect(stillWorks.status).toBe(200);
  });

  it("rejects a new password under 8 characters", async () => {
    const email = `henry${TEST_EMAIL_DOMAIN}`;
    const agent = request.agent(app);
    await agent.post("/api/auth/signup").send({ email, password: "correct-horse" });

    const res = await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: "correct-horse", newPassword: "short" });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: "whatever", newPassword: "new-correct-horse" });
    expect(res.status).toBe(401);
  });
});
