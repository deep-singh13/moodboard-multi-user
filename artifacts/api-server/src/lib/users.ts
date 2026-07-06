import bcrypt from "bcrypt";
import { pool } from "./db";

export interface User {
  id: string;
  email: string;
}

const BCRYPT_ROUNDS = 12;

export async function createUser(email: string, password: string): Promise<User> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const result = await pool.query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email`,
    [email, passwordHash],
  );
  return result.rows[0];
}

export async function verifyUserPassword(
  email: string,
  password: string,
): Promise<User | null> {
  const result = await pool.query<{ id: string; email: string; password_hash: string }>(
    `SELECT id, email, password_hash FROM users WHERE email = $1`,
    [email],
  );
  const row = result.rows[0];
  if (!row) return null;

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) return null;

  return { id: row.id, email: row.email };
}
