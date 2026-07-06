import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, initDb } from "./db";
import { createUser, verifyUserPassword, updatePassword } from "./users";

const TEST_EMAIL_DOMAIN = "@users-lib-test.example.com";

async function cleanup() {
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

describe("createUser", () => {
  it("creates a user with a hashed password", async () => {
    const email = `alice${TEST_EMAIL_DOMAIN}`;
    const user = await createUser(email, "correct-horse");

    expect(user.email).toBe(email);
    expect(user.id).toBeTypeOf("string");

    const row = await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
    expect(row.rows[0].password_hash).not.toBe("correct-horse");
  });

  it("rejects a duplicate email", async () => {
    const email = `bob${TEST_EMAIL_DOMAIN}`;
    await createUser(email, "correct-horse");
    await expect(createUser(email, "another-password")).rejects.toThrow();
  });
});

describe("verifyUserPassword", () => {
  it("returns the user for correct credentials", async () => {
    const email = `carol${TEST_EMAIL_DOMAIN}`;
    const created = await createUser(email, "correct-horse");

    const verified = await verifyUserPassword(email, "correct-horse");
    expect(verified).toEqual({ id: created.id, email });
  });

  it("returns null for an incorrect password", async () => {
    const email = `dave${TEST_EMAIL_DOMAIN}`;
    await createUser(email, "correct-horse");

    const verified = await verifyUserPassword(email, "wrong-password");
    expect(verified).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    const verified = await verifyUserPassword(`nobody${TEST_EMAIL_DOMAIN}`, "whatever");
    expect(verified).toBeNull();
  });
});

describe("updatePassword", () => {
  it("changes the password so the old one no longer verifies and the new one does", async () => {
    const email = `erin${TEST_EMAIL_DOMAIN}`;
    const created = await createUser(email, "old-password-123");

    await updatePassword(created.id, "new-password-456");

    const oldAttempt = await verifyUserPassword(email, "old-password-123");
    expect(oldAttempt).toBeNull();

    const newAttempt = await verifyUserPassword(email, "new-password-456");
    expect(newAttempt).toEqual({ id: created.id, email });
  });
});
