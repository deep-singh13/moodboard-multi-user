import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { pool, initDb } from "../lib/db";

const TEST_EMAIL_DOMAIN = "@items-route-test.example.com";

async function cleanup() {
  await pool.query(
    "DELETE FROM items WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)",
    [`%${TEST_EMAIL_DOMAIN}`],
  );
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${TEST_EMAIL_DOMAIN}`]);
}

async function signupAgent(email: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/signup").send({ email, password: "correct-horse" });
  return agent;
}

beforeAll(async () => {
  await initDb();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("GET /api/items", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/items");
    expect(res.status).toBe(401);
  });

  it("only returns the requesting user's items", async () => {
    const alice = await signupAgent(`alice${TEST_EMAIL_DOMAIN}`);
    const bob = await signupAgent(`bob${TEST_EMAIL_DOMAIN}`);

    await alice.post("/api/items").send({
      id: "item-alice-1",
      type: "link",
      addedAt: new Date().toISOString(),
      board: "moodboard",
    });

    const aliceItems = await alice.get("/api/items");
    expect(aliceItems.body.map((i: { id: string }) => i.id)).toContain("item-alice-1");

    const bobItems = await bob.get("/api/items");
    expect(bobItems.body.map((i: { id: string }) => i.id)).not.toContain("item-alice-1");
  });
});

describe("DELETE /api/items/:id", () => {
  it("does not let one user delete another user's item", async () => {
    const alice = await signupAgent(`alice2${TEST_EMAIL_DOMAIN}`);
    const bob = await signupAgent(`bob2${TEST_EMAIL_DOMAIN}`);

    await alice.post("/api/items").send({
      id: "item-alice-2",
      type: "link",
      addedAt: new Date().toISOString(),
      board: "moodboard",
    });

    await bob.delete("/api/items/item-alice-2");

    const stillThere = await pool.query("SELECT id FROM items WHERE id = $1", ["item-alice-2"]);
    expect(stillThere.rows).toHaveLength(1);
  });
});

describe("PATCH /api/items/:id", () => {
  it("does not let one user edit another user's item", async () => {
    const alice = await signupAgent(`alice3${TEST_EMAIL_DOMAIN}`);
    const bob = await signupAgent(`bob3${TEST_EMAIL_DOMAIN}`);

    await alice.post("/api/items").send({
      id: "item-alice-3",
      type: "link",
      addedAt: new Date().toISOString(),
      board: "moodboard",
      note: "original",
    });

    await bob.patch("/api/items/item-alice-3").send({ note: "hijacked" });

    const row = await pool.query("SELECT note FROM items WHERE id = $1", ["item-alice-3"]);
    expect(row.rows[0].note).toBe("original");
  });
});
