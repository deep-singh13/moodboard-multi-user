# Multi-Account Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-account authentication (email + password) and per-user data isolation to the moodboard app, so each account sees only its own `moodboard`/`discover` items.

**Architecture:** Postgres-backed sessions (`express-session` + `connect-pg-simple`) authenticate the web app via an httpOnly cookie; a `requireAuth` middleware attaches `req.user` and gates `/api/items*`; every `items` query is scoped by a new `user_id` column. The frontend gains a `wouter`-routed `/login` and `/signup`, an `AuthProvider`/`useAuth()` context, and a `RequireAuth` gate wrapping the existing `Moodboard` page — none of which changes the moodboard/discover/quotes UI itself.

**Tech Stack:** Express 5, `pg`, `express-session`, `connect-pg-simple`, `bcrypt`, React 19, `wouter`, Vite. Tests: `vitest` + `supertest` (backend), `vitest` + `@testing-library/react` (frontend) — first test infrastructure in this monorepo.

**Spec:** `docs/superpowers/specs/2026-07-06-multi-account-design.md`

## Global Constraints

- Data isolation is **fully private per user** — no shared/collaborative boards. `discover` is just another per-user content bucket in the same `items` table, scoped identically to `moodboard`.
- Auth is **email + password only**. No email verification, no password reset, no OAuth in this phase.
- Sessions are **Postgres-backed** (`express-session` + `connect-pg-simple`), not stateless JWT — logout must immediately revoke server-side.
- Passwords hashed with **bcrypt**.
- Schema stays as **raw SQL in `artifacts/api-server/src/lib/db.ts`'s `initDb()`** — do not migrate to the unused Drizzle setup in `lib/db` as part of this work.
- The browser extension (`extension/`) is explicitly **not updated** — it will start getting `401`s once `/api/items*` requires auth, and that's accepted for this phase.
- No data migration — this is a fresh repo with no existing rows.
- The SSRF fix in `artifacts/api-server/src/routes/fetchOg.ts` (commit `dec8110`) is already done and is unrelated to this plan.

## Local Test Database Setup

Do this once before running any backend test task. The backend tests hit a real Postgres (matching how this app already requires `DATABASE_URL` everywhere — no mocking of `pg`).

```bash
docker run --rm -d --name moodboard-test-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=moodboard_test \
  -p 5433:5432 \
  postgres:16
```

Create `artifacts/api-server/.env` (already covered by `.gitignore` after Task 1 — never commit this file):

```
DATABASE_URL=postgres://postgres:postgres@localhost:5433/moodboard_test
PORT=3000
NODE_ENV=development
SESSION_SECRET=test-session-secret-do-not-use-in-production
```

---

## Task 1: Test tooling, auth dependencies, and env hygiene (api-server)

**Files:**
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/vitest.config.ts`
- Create: `artifacts/api-server/vitest.setup.ts`
- Modify: `artifacts/api-server/.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `pnpm --filter @workspace/api-server test` runs `vitest run`. `SESSION_SECRET` env var is now documented as required.

- [ ] **Step 1: Add dependencies and the `test` script**

Edit `artifacts/api-server/package.json`. Add to `"scripts"`:

```json
    "test": "vitest run",
```

Add to `"dependencies"`:

```json
    "bcrypt": "^5.1.1",
    "connect-pg-simple": "^10.0.0",
    "express-session": "^1.18.1",
```

Add to `"devDependencies"`:

```json
    "@types/bcrypt": "^5.0.2",
    "@types/connect-pg-simple": "^7.0.3",
    "@types/express-session": "^1.18.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "vitest": "^3.0.5",
```

- [ ] **Step 2: Add vitest config and setup file**

Create `artifacts/api-server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    testTimeout: 15000,
  },
});
```

Create `artifacts/api-server/vitest.setup.ts`:

```ts
import "dotenv/config";
```

- [ ] **Step 3: Document `SESSION_SECRET` and gitignore local env files**

Edit `artifacts/api-server/.env.example`, add a line:

```
SESSION_SECRET=replace-with-a-long-random-string
```

Edit `.gitignore` (repo root), add under the `# System Files` section:

```
# Environment secrets
.env
.env.*
!.env.example
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`
Expected: lockfile updates, no errors. (Requires network access to the npm registry.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/package.json artifacts/api-server/vitest.config.ts \
  artifacts/api-server/vitest.setup.ts artifacts/api-server/.env.example \
  .gitignore pnpm-lock.yaml
git commit -m "chore(api-server): add auth deps and vitest test tooling"
```

---

## Task 2: Extend DB schema — users, sessions, items.user_id

**Files:**
- Modify: `artifacts/api-server/src/lib/db.ts`
- Test: `artifacts/api-server/src/lib/db.test.ts`

**Interfaces:**
- Consumes: `pool` (existing export from `db.ts`), Local Test Database Setup above.
- Produces: `users` table (`id uuid`, `email text unique`, `password_hash text`, `created_at timestamptz`), `sessions` table (`sid varchar` PK, `sess json`, `expire timestamptz`), `items.user_id uuid not null references users(id)`. These exact column/table names are relied on by Tasks 3–7.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/db.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- src/lib/db.test.ts`
Expected: FAIL — `users`/`sessions` tables don't exist yet (or `user_id` column missing).

- [ ] **Step 3: Add the schema to `initDb()`**

Edit `artifacts/api-server/src/lib/db.ts`, replacing the whole `initDb` function body with the existing statements plus these new ones appended at the end (keep every existing `CREATE TABLE`/`ALTER TABLE` call unchanged, just add after them):

```ts
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT        NOT NULL UNIQUE,
      password_hash TEXT        NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid    VARCHAR     PRIMARY KEY,
      sess   JSON        NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions (expire)
  `);
  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS user_id UUID NOT NULL REFERENCES users(id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_items_user_id ON items (user_id)
  `);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- src/lib/db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/db.ts artifacts/api-server/src/lib/db.test.ts
git commit -m "feat(api-server): add users/sessions tables and items.user_id column"
```

---

## Task 3: Session middleware factory

**Files:**
- Create: `artifacts/api-server/src/lib/session.ts`
- Test: `artifacts/api-server/src/lib/session.test.ts`

**Interfaces:**
- Consumes: `pool` from `./db`, `sessions` table from Task 2.
- Produces: `createSessionMiddleware(): RequestHandler` — used by Task 6 in `app.ts`. Requires `process.env.SESSION_SECRET` to be set; throws otherwise.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/session.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createSessionMiddleware } from "./session";

describe("createSessionMiddleware", () => {
  const originalSecret = process.env.SESSION_SECRET;

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
  });

  it("throws when SESSION_SECRET is not set", () => {
    delete process.env.SESSION_SECRET;
    expect(() => createSessionMiddleware()).toThrow(/SESSION_SECRET/);
  });

  it("returns a middleware function when SESSION_SECRET is set", () => {
    process.env.SESSION_SECRET = "test-secret";
    const middleware = createSessionMiddleware();
    expect(typeof middleware).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- src/lib/session.test.ts`
Expected: FAIL — `./session` module does not exist.

- [ ] **Step 3: Implement**

Create `artifacts/api-server/src/lib/session.ts`:

```ts
import session, { type RequestHandler } from "express-session";
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- src/lib/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/session.ts artifacts/api-server/src/lib/session.test.ts
git commit -m "feat(api-server): add Postgres-backed session middleware factory"
```

---

## Task 4: `requireAuth` middleware + session/request type augmentation

**Files:**
- Create: `artifacts/api-server/src/middlewares/require-auth.ts`
- Test: `artifacts/api-server/src/middlewares/require-auth.test.ts`
- Delete: `artifacts/api-server/src/middlewares/.gitkeep` (no longer an empty directory)

**Interfaces:**
- Produces: `requireAuth(req, res, next)` Express middleware. Reads `req.session.userId`/`req.session.userEmail`, sets `req.user = { id, email }` on success or responds `401 { error }` otherwise. Also declares `SessionData.userId`/`userEmail` (used by Task 6's auth routes) and `Express.Request.user` (used by Tasks 6 and 7).

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/middlewares/require-auth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { requireAuth } from "./require-auth";

function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("requireAuth", () => {
  it("responds 401 when there is no session user", () => {
    const req = { session: {} } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.user and calls next when the session has a user", () => {
    const req = {
      session: { userId: "user-1", userEmail: "a@example.com" },
    } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next);

    expect(req.user).toEqual({ id: "user-1", email: "a@example.com" });
    expect(next).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- src/middlewares/require-auth.test.ts`
Expected: FAIL — `./require-auth` module does not exist.

- [ ] **Step 3: Implement**

Delete `artifacts/api-server/src/middlewares/.gitkeep`.

Create `artifacts/api-server/src/middlewares/require-auth.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- src/middlewares/require-auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/middlewares/require-auth.ts \
  artifacts/api-server/src/middlewares/require-auth.test.ts
git rm artifacts/api-server/src/middlewares/.gitkeep
git commit -m "feat(api-server): add requireAuth middleware"
```

---

## Task 5: User data-access module

**Files:**
- Create: `artifacts/api-server/src/lib/users.ts`
- Test: `artifacts/api-server/src/lib/users.test.ts`

**Interfaces:**
- Consumes: `pool` from `./db`, `users` table from Task 2.
- Produces: `createUser(email: string, password: string): Promise<{ id: string; email: string }>`, `verifyUserPassword(email: string, password: string): Promise<{ id: string; email: string } | null>`. Both used by Task 6's `routes/auth.ts`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/lib/users.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool, initDb } from "./db";
import { createUser, verifyUserPassword } from "./users";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- src/lib/users.test.ts`
Expected: FAIL — `./users` module does not exist.

- [ ] **Step 3: Implement**

Create `artifacts/api-server/src/lib/users.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- src/lib/users.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/users.ts artifacts/api-server/src/lib/users.test.ts
git commit -m "feat(api-server): add user creation and password verification"
```

---

## Task 6: Auth routes + wire session/CORS into the app

**Files:**
- Create: `artifacts/api-server/src/routes/auth.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Test: `artifacts/api-server/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: `createUser`/`verifyUserPassword` (Task 5), `requireAuth` (Task 4), `createSessionMiddleware` (Task 3).
- Produces: `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` — response shape `{ id: string, email: string }` on success, `{ error: string }` on failure. Relied on by the frontend Task 9 (`lib/auth-api.ts`).

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/routes/auth.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- src/routes/auth.test.ts`
Expected: FAIL — `/api/auth/signup` returns 404 (route doesn't exist yet), and importing `app` fails without `SESSION_SECRET` set (make sure `.env` from "Local Test Database Setup" is in place first).

- [ ] **Step 3: Implement the auth routes**

Create `artifacts/api-server/src/routes/auth.ts`:

```ts
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
```

- [ ] **Step 4: Mount the auth router**

Edit `artifacts/api-server/src/routes/index.ts`:

```ts
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import itemsRouter from "./items";
import fetchOgRouter from "./fetchOg";
import movieSearchRouter from "./movieSearch";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(itemsRouter);
router.use(fetchOgRouter);
router.use(movieSearchRouter);

export default router;
```

- [ ] **Step 5: Wire session middleware and credentialed CORS into the app**

Edit `artifacts/api-server/src/app.ts`. Add the import:

```ts
import { createSessionMiddleware } from "./lib/session";
```

Replace:

```ts
app.use(cors());
```

with:

```ts
app.use(cors({ origin: true, credentials: true }));
app.use(createSessionMiddleware());
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- src/routes/auth.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/auth.ts artifacts/api-server/src/routes/auth.test.ts \
  artifacts/api-server/src/routes/index.ts artifacts/api-server/src/app.ts
git commit -m "feat(api-server): add signup/login/logout/me auth routes"
```

---

## Task 7: Scope `items` routes by owner

**Files:**
- Modify: `artifacts/api-server/src/routes/items.ts`
- Test: `artifacts/api-server/src/routes/items.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (Task 4), `req.user.id` (set by `requireAuth`).
- Produces: `/api/items*` now requires authentication; every row is scoped to `req.user.id`. Response shape for `MoodboardItem` is unchanged (`user_id` is never serialized to the client).

- [ ] **Step 1: Write the failing test**

Create `artifacts/api-server/src/routes/items.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- src/routes/items.test.ts`
Expected: FAIL — `/api/items` currently has no auth requirement (401 test fails) and no ownership scoping.

- [ ] **Step 3: Implement**

Replace the full contents of `artifacts/api-server/src/routes/items.ts`:

```ts
import { Router, type IRouter } from "express";
import { pool } from "../lib/db";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

router.use("/items", requireAuth);

function rowToItem(row: Record<string, unknown>) {
  return {
    id: row.id,
    type: row.type,
    url: row.url ?? undefined,
    title: row.title ?? undefined,
    subtitle: row.subtitle ?? undefined,
    imageUrl:
      (row.image_url as string | null) ??
      (row.image_data as string | null) ??
      undefined,
    size: row.size ? Number(row.size) : undefined,
    addedAt: row.added_at,
    completed: row.completed ?? false,
    note: (row.note as string | null) ?? undefined,
    board: (row.board as string | null) ?? "moodboard",
    meta: (row.meta as string | null) ?? undefined,
  };
}

router.get("/items", async (req, res) => {
  const board = (req.query.board as string | undefined) ?? "moodboard";
  try {
    const result = await pool.query(
      "SELECT * FROM items WHERE user_id = $1 AND board = $2 ORDER BY added_at ASC",
      [req.user!.id, board],
    );
    res.json(result.rows.map(rowToItem));
  } catch {
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

router.post("/items", async (req, res) => {
  const body = req.body as Record<string, string | null | undefined>;
  const { id, type, url, title, subtitle, imageUrl, size, addedAt, board, meta } =
    body;
  const note = (body.note as string | null | undefined) ?? null;

  const isDataUrl = (imageUrl ?? "").startsWith("data:");
  const imageUrlDb = isDataUrl ? null : (imageUrl ?? null);
  const imageDataDb = isDataUrl ? (imageUrl ?? null) : null;

  try {
    const result = await pool.query(
      `INSERT INTO items
         (id, type, url, title, subtitle, image_url, size,
          position_x, position_y, added_at, image_data, note, board, meta, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7, 0,0,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        id,
        type,
        url ?? null,
        title ?? null,
        subtitle ?? null,
        imageUrlDb,
        String(size ?? 320),
        addedAt ?? new Date().toISOString(),
        imageDataDb,
        note,
        board ?? "moodboard",
        meta ?? null,
        req.user!.id,
      ],
    );
    res.json(rowToItem(result.rows[0]));
  } catch {
    res.status(500).json({ error: "Failed to create item" });
  }
});

router.delete("/items/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM items WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.user!.id,
    ]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete item" });
  }
});

router.patch("/items/:id", async (req, res) => {
  const body = req.body as {
    completed?: boolean;
    note?: string | null;
    title?: string | null;
    imageUrl?: string | null;
    subtitle?: string | null;
    meta?: string | null;
  };
  const userId = req.user!.id;
  try {
    if (body.completed !== undefined) {
      await pool.query("UPDATE items SET completed = $1 WHERE id = $2 AND user_id = $3", [
        body.completed,
        req.params.id,
        userId,
      ]);
    }
    if ("note" in body) {
      await pool.query("UPDATE items SET note = $1 WHERE id = $2 AND user_id = $3", [
        body.note ?? null,
        req.params.id,
        userId,
      ]);
    }
    if ("title" in body) {
      await pool.query("UPDATE items SET title = $1 WHERE id = $2 AND user_id = $3", [
        body.title ?? null,
        req.params.id,
        userId,
      ]);
    }
    if ("subtitle" in body) {
      await pool.query("UPDATE items SET subtitle = $1 WHERE id = $2 AND user_id = $3", [
        body.subtitle ?? null,
        req.params.id,
        userId,
      ]);
    }
    if ("meta" in body) {
      await pool.query("UPDATE items SET meta = $1 WHERE id = $2 AND user_id = $3", [
        body.meta ?? null,
        req.params.id,
        userId,
      ]);
    }
    if ("imageUrl" in body) {
      const imageUrl = body.imageUrl ?? null;
      const isDataUrl = typeof imageUrl === "string" && imageUrl.startsWith("data:");
      if (isDataUrl) {
        await pool.query(
          "UPDATE items SET image_data = $1, image_url = NULL WHERE id = $2 AND user_id = $3",
          [imageUrl, req.params.id, userId],
        );
      } else {
        await pool.query(
          "UPDATE items SET image_url = $1, image_data = NULL WHERE id = $2 AND user_id = $3",
          [imageUrl, req.params.id, userId],
        );
      }
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update item" });
  }
});

export default router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- src/routes/items.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: All tests (db, session, require-auth, users, auth, items) PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/items.ts artifacts/api-server/src/routes/items.test.ts
git commit -m "feat(api-server): scope items routes by authenticated user"
```

---

## Task 8: Frontend test tooling + `credentials: include` on existing API calls

**Files:**
- Modify: `artifacts/moodboard/package.json`
- Create: `artifacts/moodboard/vitest.config.ts`
- Create: `artifacts/moodboard/vitest.setup.ts`
- Modify: `artifacts/moodboard/src/lib/api.ts`
- Test: `artifacts/moodboard/src/lib/api.test.ts`

**Interfaces:**
- Produces: `pnpm --filter @workspace/moodboard test` runs `vitest run`. All existing `lib/api.ts` functions now send `credentials: "include"`.

- [ ] **Step 1: Add test tooling dependencies**

Edit `artifacts/moodboard/package.json`. Add to `"scripts"`:

```json
    "test": "vitest run",
```

Add to `"devDependencies"`:

```json
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "jsdom": "^25.0.1",
    "vitest": "^3.0.5",
```

- [ ] **Step 2: Add vitest config**

Create `artifacts/moodboard/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
  },
});
```

Create `artifacts/moodboard/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 4: Write the failing test**

Create `artifacts/moodboard/src/lib/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchItems, createItem, deleteItem, patchItemComplete } from "./api";

function mockFetchOnce(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("lib/api credentials", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchItems sends credentials: include", async () => {
    mockFetchOnce([]);
    await fetchItems("moodboard");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/items"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("createItem sends credentials: include", async () => {
    mockFetchOnce({ id: "1" });
    await createItem({ id: "1", type: "link", url: "https://example.com", addedAt: "now" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/items",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("deleteItem sends credentials: include", async () => {
    mockFetchOnce({ ok: true });
    await deleteItem("1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/items/1",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("patchItemComplete sends credentials: include", async () => {
    mockFetchOnce({ ok: true });
    await patchItemComplete("1", true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/items/1",
      expect.objectContaining({ method: "PATCH", credentials: "include" }),
    );
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @workspace/moodboard test -- src/lib/api.test.ts`
Expected: FAIL — none of the current `fetch()` calls pass `credentials`.

- [ ] **Step 6: Add `credentials: "include"` to every fetch call**

Edit `artifacts/moodboard/src/lib/api.ts`. Add `credentials: "include"` to the options object of every `fetch(...)` call in the file (`fetchItems`, `createItem`, `deleteItem`, `patchItemComplete`, `patchItemNote`, `patchItemEdit`, `fetchOgMeta`, `fetchMovieSearch`, `fetchMovieDetail`). For example:

```ts
export async function fetchItems(board: string = "moodboard"): Promise<MoodboardItem[]> {
  const res = await fetch(`${BASE}/items?board=${encodeURIComponent(board)}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to fetch items: ${res.status}`);
  return res.json();
}

export async function createItem(item: MoodboardItem): Promise<MoodboardItem> {
  const res = await fetch(`${BASE}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`Failed to create item: ${res.status}`);
  return res.json();
}
```

Apply the same `credentials: "include"` addition to the options object in `deleteItem`, `patchItemComplete`, `patchItemNote`, `patchItemEdit`, `fetchOgMeta`, `fetchMovieSearch`, and `fetchMovieDetail` — every exported function in this file.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @workspace/moodboard test -- src/lib/api.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add artifacts/moodboard/package.json artifacts/moodboard/vitest.config.ts \
  artifacts/moodboard/vitest.setup.ts artifacts/moodboard/src/lib/api.ts \
  artifacts/moodboard/src/lib/api.test.ts pnpm-lock.yaml
git commit -m "chore(moodboard): add vitest tooling, send credentials on all API calls"
```

---

## Task 9: Auth API client

**Files:**
- Create: `artifacts/moodboard/src/lib/auth-api.ts`
- Test: `artifacts/moodboard/src/lib/auth-api.test.ts`

**Interfaces:**
- Produces: `AuthUser { id: string; email: string }`, `signup(email, password): Promise<AuthUser>`, `login(email, password): Promise<AuthUser>`, `logout(): Promise<void>`, `fetchMe(): Promise<AuthUser | null>`. Used by Task 10's `useAuth()`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/moodboard/src/lib/auth-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { signup, login, logout, fetchMe } from "./auth-api";

function mockFetchOnce(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("auth-api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("signup returns the created user on success", async () => {
    mockFetchOnce(201, { id: "u1", email: "a@example.com" });
    const user = await signup("a@example.com", "password123");
    expect(user).toEqual({ id: "u1", email: "a@example.com" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/signup",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("signup throws the server error message on failure", async () => {
    mockFetchOnce(409, { error: "An account with this email already exists" });
    await expect(signup("a@example.com", "password123")).rejects.toThrow(
      "An account with this email already exists",
    );
  });

  it("login returns the user on success", async () => {
    mockFetchOnce(200, { id: "u1", email: "a@example.com" });
    const user = await login("a@example.com", "password123");
    expect(user).toEqual({ id: "u1", email: "a@example.com" });
  });

  it("login throws on failure", async () => {
    mockFetchOnce(401, { error: "Invalid email or password" });
    await expect(login("a@example.com", "wrong")).rejects.toThrow("Invalid email or password");
  });

  it("fetchMe returns null when unauthenticated", async () => {
    mockFetchOnce(401, { error: "Not authenticated" });
    const user = await fetchMe();
    expect(user).toBeNull();
  });

  it("fetchMe returns the user when authenticated", async () => {
    mockFetchOnce(200, { id: "u1", email: "a@example.com" });
    const user = await fetchMe();
    expect(user).toEqual({ id: "u1", email: "a@example.com" });
  });

  it("logout calls the logout endpoint", async () => {
    mockFetchOnce(200, { ok: true });
    await logout();
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/moodboard test -- src/lib/auth-api.test.ts`
Expected: FAIL — `./auth-api` module does not exist.

- [ ] **Step 3: Implement**

Create `artifacts/moodboard/src/lib/auth-api.ts`:

```ts
export interface AuthUser {
  id: string;
  email: string;
}

const BASE = "/api/auth";

async function parseJsonOrThrow(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  return (await parseJsonOrThrow(res)) as AuthUser;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  return (await parseJsonOrThrow(res)) as AuthUser;
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/logout`, { method: "POST", credentials: "include" });
}

export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE}/me`, { credentials: "include" });
  if (res.status === 401) return null;
  return (await parseJsonOrThrow(res)) as AuthUser;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/moodboard test -- src/lib/auth-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/moodboard/src/lib/auth-api.ts artifacts/moodboard/src/lib/auth-api.test.ts
git commit -m "feat(moodboard): add auth API client"
```

---

## Task 10: `AuthProvider` / `useAuth()` context

**Files:**
- Create: `artifacts/moodboard/src/hooks/useAuth.tsx`
- Test: `artifacts/moodboard/src/hooks/useAuth.test.tsx`

**Interfaces:**
- Consumes: `fetchMe`, `login`, `signup`, `logout`, `AuthUser` from `@/lib/auth-api` (Task 9).
- Produces: `<AuthProvider>` component, `useAuth(): { user: AuthUser | null; loading: boolean; login; signup; logout }`. Used by Tasks 11, 12, 13.

- [ ] **Step 1: Write the failing test**

Create `artifacts/moodboard/src/hooks/useAuth.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./useAuth";

vi.mock("@/lib/auth-api", () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
}));

import { fetchMe } from "@/lib/auth-api";

function Consumer() {
  const { user, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{user ? `hello ${user.email}` : "logged out"}</div>;
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockReset();
  });

  it("shows loading then the user once fetchMe resolves", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: "u1", email: "a@example.com" });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    expect(screen.getByText("loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("hello a@example.com")).toBeInTheDocument());
  });

  it("shows logged out state when fetchMe resolves null", async () => {
    vi.mocked(fetchMe).mockResolvedValue(null);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("logged out")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/moodboard test -- src/hooks/useAuth.test.tsx`
Expected: FAIL — `./useAuth` module does not exist.

- [ ] **Step 3: Implement**

Create `artifacts/moodboard/src/hooks/useAuth.tsx`:

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  fetchMe,
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
  type AuthUser,
} from "@/lib/auth-api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const loggedInUser = await apiLogin(email, password);
    setUser(loggedInUser);
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const newUser = await apiSignup(email, password);
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/moodboard test -- src/hooks/useAuth.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/moodboard/src/hooks/useAuth.tsx artifacts/moodboard/src/hooks/useAuth.test.tsx
git commit -m "feat(moodboard): add AuthProvider/useAuth context"
```

---

## Task 11: Login and signup pages

**Files:**
- Create: `artifacts/moodboard/src/pages/login.tsx`
- Create: `artifacts/moodboard/src/pages/signup.tsx`
- Test: `artifacts/moodboard/src/pages/login.test.tsx`
- Test: `artifacts/moodboard/src/pages/signup.test.tsx`
- Modify: `artifacts/moodboard/src/index.css`

**Interfaces:**
- Consumes: `useAuth()` (Task 10), `wouter`'s `Link`/`useLocation`.
- Produces: default-exported `Login` and `Signup` page components. Used by Task 12's `App.tsx` routing.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/moodboard/src/pages/login.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Login from "./login";

const mockLogin = vi.fn();
const mockSetLocation = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ login: mockLogin, signup: vi.fn(), logout: vi.fn(), user: null, loading: false }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/login", mockSetLocation],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("Login page", () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockSetLocation.mockReset();
  });

  it("logs in and redirects to / on success", async () => {
    mockLogin.mockResolvedValue(undefined);
    render(<Login />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("a@example.com", "password123"));
    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith("/"));
  });

  it("shows an error message when login fails", async () => {
    mockLogin.mockRejectedValue(new Error("Invalid email or password"));
    render(<Login />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrongpass" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));

    await waitFor(() =>
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument(),
    );
    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});
```

Create `artifacts/moodboard/src/pages/signup.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Signup from "./signup";

const mockSignup = vi.fn();
const mockSetLocation = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ signup: mockSignup, login: vi.fn(), logout: vi.fn(), user: null, loading: false }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/signup", mockSetLocation],
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("Signup page", () => {
  beforeEach(() => {
    mockSignup.mockReset();
    mockSetLocation.mockReset();
  });

  it("rejects a short password before calling the API", async () => {
    render(<Signup />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(mockSignup).not.toHaveBeenCalled();
  });

  it("signs up and redirects to / on success", async () => {
    mockSignup.mockResolvedValue(undefined);
    render(<Signup />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign up/i }));

    await waitFor(() => expect(mockSignup).toHaveBeenCalledWith("a@example.com", "password123"));
    await waitFor(() => expect(mockSetLocation).toHaveBeenCalledWith("/"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/moodboard test -- src/pages/login.test.tsx src/pages/signup.test.tsx`
Expected: FAIL — `./login` and `./signup` modules do not exist.

- [ ] **Step 3: Implement the pages**

Create `artifacts/moodboard/src/pages/login.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      setLocation("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log in");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1 className="auth-title">Log in</h1>
        {error && <div className="modal-error">{error}</div>}
        <label className="auth-label" htmlFor="email">Email</label>
        <input
          id="email"
          className="modal-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label className="auth-label" htmlFor="password">Password</label>
        <input
          id="password"
          className="modal-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="auth-button" type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
        <p className="auth-switch">
          No account? <Link href="/signup">Sign up</Link>
        </p>
      </form>
    </div>
  );
}
```

Create `artifacts/moodboard/src/pages/signup.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

const MIN_PASSWORD_LENGTH = 8;

export default function Signup() {
  const { signup } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setSubmitting(true);
    try {
      await signup(email, password);
      setLocation("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign up");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1 className="auth-title">Sign up</h1>
        {error && <div className="modal-error">{error}</div>}
        <label className="auth-label" htmlFor="email">Email</label>
        <input
          id="email"
          className="modal-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label className="auth-label" htmlFor="password">Password</label>
        <input
          id="password"
          className="modal-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="auth-button" type="submit" disabled={submitting}>
          {submitting ? "Signing up…" : "Sign up"}
        </button>
        <p className="auth-switch">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Add auth page CSS**

Append to the end of `artifacts/moodboard/src/index.css`:

```css
/* ── Auth pages (login/signup) ────────────────────────────── */

.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-canvas);
  padding: var(--space-6);
}

.auth-form {
  width: 100%;
  max-width: 360px;
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  border-radius: 20px;
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.auth-title {
  font-family: 'Instrument Serif', Georgia, serif;
  font-size: var(--text-2xl);
  color: var(--text-primary);
  margin: 0 0 var(--space-3);
}

.auth-label {
  font-family: 'DM Sans', sans-serif;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: calc(var(--space-1) * -1);
}

.auth-button {
  margin-top: var(--space-3);
  padding: 12px 15px;
  background: var(--bg-btn-add);
  border: none;
  border-radius: 12px;
  color: white;
  font-family: 'DM Sans', sans-serif;
  font-size: var(--text-md);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.auth-button:hover:not(:disabled) {
  background: var(--bg-btn-add-hover);
}

.auth-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.auth-switch {
  font-family: 'DM Sans', sans-serif;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  text-align: center;
  margin: var(--space-3) 0 0;
}

.auth-switch a {
  color: var(--bg-btn-add);
}

.auth-loading {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @workspace/moodboard test -- src/pages/login.test.tsx src/pages/signup.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add artifacts/moodboard/src/pages/login.tsx artifacts/moodboard/src/pages/signup.tsx \
  artifacts/moodboard/src/pages/login.test.tsx artifacts/moodboard/src/pages/signup.test.tsx \
  artifacts/moodboard/src/index.css
git commit -m "feat(moodboard): add login and signup pages"
```

---

## Task 12: `RequireAuth` gate + routing in `App.tsx`

**Files:**
- Create: `artifacts/moodboard/src/components/RequireAuth.tsx`
- Test: `artifacts/moodboard/src/components/RequireAuth.test.tsx`
- Modify: `artifacts/moodboard/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth()` (Task 10), `Login`/`Signup` (Task 11), `wouter`'s `Switch`/`Route`/`Redirect`.
- Produces: `<RequireAuth>{children}</RequireAuth>` — redirects to `/login` when unauthenticated, shows a loading state while `useAuth().loading` is true, otherwise renders children.

- [ ] **Step 1: Write the failing test**

Create `artifacts/moodboard/src/components/RequireAuth.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RequireAuth } from "./RequireAuth";

const mockUseAuth = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) => <div>redirecting to {to}</div>,
}));

describe("RequireAuth", () => {
  it("shows a loading state while auth is resolving", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("redirects to /login when there is no user", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(screen.getByText("redirecting to /login")).toBeInTheDocument();
  });

  it("renders children when authenticated", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1", email: "a@example.com" }, loading: false });
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(screen.getByText("secret")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/moodboard test -- src/components/RequireAuth.test.tsx`
Expected: FAIL — `./RequireAuth` module does not exist.

- [ ] **Step 3: Implement**

Create `artifacts/moodboard/src/components/RequireAuth.tsx`:

```tsx
import type { ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/hooks/useAuth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="auth-loading">Loading…</div>;
  }
  if (!user) {
    return <Redirect to="/login" />;
  }
  return <>{children}</>;
}
```

Replace the full contents of `artifacts/moodboard/src/App.tsx`:

```tsx
import { Switch, Route } from "wouter";
import { AuthProvider } from "@/hooks/useAuth";
import { RequireAuth } from "@/components/RequireAuth";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import Moodboard from "@/pages/moodboard";

function App() {
  return (
    <AuthProvider>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route>
          <RequireAuth>
            <Moodboard />
          </RequireAuth>
        </Route>
      </Switch>
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/moodboard test -- src/components/RequireAuth.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/moodboard/src/components/RequireAuth.tsx \
  artifacts/moodboard/src/components/RequireAuth.test.tsx artifacts/moodboard/src/App.tsx
git commit -m "feat(moodboard): gate the app behind RequireAuth with login/signup routes"
```

---

## Task 13: Account menu in the header

**Files:**
- Create: `artifacts/moodboard/src/components/AccountMenu.tsx`
- Test: `artifacts/moodboard/src/components/AccountMenu.test.tsx`
- Modify: `artifacts/moodboard/src/pages/moodboard.tsx:5,549`
- Modify: `artifacts/moodboard/src/index.css`

**Interfaces:**
- Consumes: `useAuth()` (Task 10).
- Produces: `<AccountMenu />` — renders nothing when logged out, otherwise the user's email and a "Log out" button.

- [ ] **Step 1: Write the failing test**

Create `artifacts/moodboard/src/components/AccountMenu.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AccountMenu } from "./AccountMenu";

const mockLogout = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

describe("AccountMenu", () => {
  beforeEach(() => {
    mockLogout.mockReset();
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@example.com" },
      logout: mockLogout,
    });
  });

  it("renders nothing when there is no user", () => {
    mockUseAuth.mockReturnValue({ user: null, logout: mockLogout });
    const { container } = render(<AccountMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the user's email and calls logout on click", async () => {
    mockLogout.mockResolvedValue(undefined);
    render(<AccountMenu />);

    expect(screen.getByText("a@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledOnce());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/moodboard test -- src/components/AccountMenu.test.tsx`
Expected: FAIL — `./AccountMenu` module does not exist.

- [ ] **Step 3: Implement**

Create `artifacts/moodboard/src/components/AccountMenu.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export function AccountMenu() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="account-menu">
      <span className="account-menu-email">{user.email}</span>
      <button className="account-menu-logout" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}
```

Edit `artifacts/moodboard/src/pages/moodboard.tsx`. Add the import after the existing `ThemeToggle` import (line 5):

```ts
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountMenu } from "@/components/AccountMenu";
```

Then, in the toolbar JSX, replace:

```tsx
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
```

with:

```tsx
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <AccountMenu />
      </div>
```

- [ ] **Step 4: Add account menu CSS**

Append to the end of `artifacts/moodboard/src/index.css` (after the auth-page block added in Task 11):

```css
/* ── Account menu ─────────────────────────────────────────── */

.account-menu {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.account-menu-email {
  font-family: 'DM Sans', sans-serif;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.account-menu-logout {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border-input);
  border-radius: 100px;
  color: var(--text-primary);
  font-family: 'DM Sans', sans-serif;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background 0.15s ease;
}

.account-menu-logout:hover:not(:disabled) {
  background: var(--bg-topbar);
}

.account-menu-logout:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @workspace/moodboard test -- src/components/AccountMenu.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full frontend test suite**

Run: `pnpm --filter @workspace/moodboard test`
Expected: All tests (api, auth-api, useAuth, login, signup, RequireAuth, AccountMenu) PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/moodboard/src/components/AccountMenu.tsx \
  artifacts/moodboard/src/components/AccountMenu.test.tsx \
  artifacts/moodboard/src/pages/moodboard.tsx artifacts/moodboard/src/index.css
git commit -m "feat(moodboard): add account menu with logout to the header"
```

---

## Post-Implementation Manual Verification

Automated tests cover the ownership/security-critical paths. Before considering this feature done, manually verify the full flow in a browser (tests don't drive real browser sessions end-to-end):

1. `docker run ...` per "Local Test Database Setup", and a `.env` in `artifacts/api-server` pointing at it (or a separate dev DB).
2. `pnpm --filter @workspace/api-server run dev` and `pnpm --filter @workspace/moodboard run dev` (set `PORT`/`BASE_PATH` env vars as the existing scripts require).
3. Visit the frontend URL — confirm you're redirected to `/login`.
4. Sign up as `alice@example.com` — confirm redirect to `/` and the moodboard loads empty.
5. Add an item, refresh — confirm it persists and the account menu shows `alice@example.com`.
6. Log out — confirm redirect back to `/login`.
7. Sign up as `bob@example.com` — confirm Bob's board is empty (Alice's item is not visible).
8. Log back in as Alice — confirm her item is still there.
9. Confirm the browser extension's "save to moodboard" now fails (expected — deferred per spec).

## Spec Coverage Check

- Data model (users/sessions/items.user_id) → Task 2.
- Auth backend (signup/login/logout/me, bcrypt, Postgres sessions) → Tasks 3–6.
- API ownership scoping on items → Task 7.
- Frontend credentials + auth client → Tasks 8–9.
- Auth context, login/signup UI, route gating, account menu → Tasks 10–13.
- Extension/migration non-goals → intentionally no task (documented above).
