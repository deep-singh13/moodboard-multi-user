import { describe, it, expect, afterAll } from "vitest";
import { pool, initDb } from "./db";

describe("initDb", () => {
  it("creates users, sessions tables and items.user_id column", async () => {
    await initDb();

    const users = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    );
    expect(users.rows.map((r) => r.column_name)).toEqual(
      expect.arrayContaining(["id", "email", "password_hash", "created_at"]),
    );

    const sessions = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sessions'`,
    );
    expect(sessions.rows.map((r) => r.column_name)).toEqual(
      expect.arrayContaining(["sid", "sess", "expire"]),
    );

    const userIdColumn = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'items' AND column_name = 'user_id'`,
    );
    expect(userIdColumn.rows).toHaveLength(1);
  });

  afterAll(async () => {
    await pool.end();
  });
});
