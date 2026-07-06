# Multi-Account Support — Design

## Context

This repo is a copy of the original single-tenant `moodboard` app
(`/Users/deepinder/Desktop/Claude/Personal-projects/moodboard`), taken as the
starting point for an independently-maintained fork that adds multi-account
support. The original project is not modified by this work.

Today the app has **no user concept at all**: a single shared `items` table
(`artifacts/api-server/src/lib/db.ts`), no authentication, no sessions, and
even mutation routes (`DELETE /api/items/:id`, `PATCH /api/items/:id`) have no
ownership check — any request can act on any row. The browser extension
(`extension/`) calls the API unauthenticated. `lib/db`'s Drizzle setup exists
but is unused boilerplate; the real schema is raw SQL run at boot via
`initDb()`.

## Goals

- Each user gets a fully private account: their own `moodboard` and
  `discover` items, invisible to other accounts. (`discover` is confirmed to
  be another per-user content bucket in the same `items` table — not shared
  curated content — so it follows the same isolation rule as `moodboard`.)
- Email + password signup/login, bare minimum scope: signup, login, logout.
  No email verification or password-reset flow in this phase (no email
  service dependency).
- Close the existing ownership gap on `items` mutation routes as part of
  adding scoping.

## Non-goals (this phase)

- Email verification, password reset, or any transactional email.
- Browser extension authentication — the extension will stop working against
  the auth-gated `/api/items*` routes once this ships. That's accepted for
  this phase; the recommended follow-up is a personal API token (long-lived
  token generated from an account settings page, sent as a `Bearer` header),
  reusing the existing but currently-unused `setAuthTokenGetter` hook in
  `lib/api-client-react/src/custom-fetch.ts`. Not built now.
- Data migration — this is a fresh repo with no existing rows, so no backfill
  is needed for the new `items.user_id` column.
- Migrating `lib/db`'s Drizzle setup into active use. This phase continues
  the existing raw-SQL-in-`initDb()` pattern to minimize unrelated churn.
- Fixing the pre-existing SSRF exposure in `artifacts/api-server/src/routes/fetchOg.ts`
  (unvalidated outbound `fetch(url)` on user-supplied URLs, flagged by
  automated security review of the initial copy commit). It predates this
  fork and is orthogonal to multi-account support; tracked separately rather
  than folded into this design.

## Data model

Added to `initDb()` in `artifacts/api-server/src/lib/db.ts`:

```sql
users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
)

sessions (
  sid    varchar primary key,   -- managed by connect-pg-simple
  sess   json not null,
  expire timestamptz not null
)
```

Change to the existing table:

```sql
items: add column user_id uuid not null references users(id)
```

## Auth backend

Session mechanism: **Postgres-backed sessions** via `express-session` +
`connect-pg-simple` (reusing the existing `pool`), not stateless JWT — this
allows immediate server-side revocation on logout, which matters since this
app is explicitly private-per-user data. Passwords hashed with `bcrypt`.

New `artifacts/api-server/src/routes/auth.ts`:

- `POST /api/auth/signup` — validate email/password, hash password, insert
  into `users`, create session. Returns `{ id, email }` only — never the hash.
- `POST /api/auth/login` — look up by email, `bcrypt.compare`, create session
  on success. Generic "invalid email or password" error on failure (no
  user-enumeration).
- `POST /api/auth/logout` — `req.session.destroy()`, clear cookie.
- `GET /api/auth/me` — current session's user, or `401`.

Wiring in `artifacts/api-server/src/app.ts`:

- `express-session` + `connect-pg-simple` store. Cookie: `httpOnly: true`,
  `sameSite: 'lax'`, `secure: true` in production.
- New `artifacts/api-server/src/middlewares/require-auth.ts` — reads
  `req.session.userId`, attaches `req.user = { id, email }`, or `401`s.
  Applied to all `/api/items*` routes; not applied to `/api/auth/*` or
  `/api/health`.

New dependencies: `bcrypt`, `express-session`, `connect-pg-simple` (+ their
`@types/*` dev dependencies) in `artifacts/api-server/package.json`.

## API changes to `items` routes

`artifacts/api-server/src/routes/items.ts`, scoped by `req.user.id`:

- `GET /api/items?board=...` → `WHERE user_id = $1 AND board = $2`
- `POST /api/items` → insert includes `user_id: req.user.id` (server-assigned,
  ignoring any client-supplied owner field)
- `DELETE /api/items/:id` → `WHERE id = $1 AND user_id = $2`
- `PATCH /api/items/:id` → every `UPDATE` gets `AND user_id = $N` appended

No change to the `MoodboardItem` request/response shape — `user_id` is
server-side only and never serialized back to the client.

## Frontend changes

- `lib/api-client-react/src/custom-fetch.ts`: add `credentials: 'include'` to
  every request so the session cookie flows on cross-origin requests (not set
  today).
- `artifacts/moodboard/src/App.tsx` currently renders `<Moodboard />` directly
  with no routing. `wouter` is already a dependency but unused — use it to add
  `/login`, `/signup`, and gate the existing app behind auth.
- New `AuthProvider` / `useAuth()` context: on mount calls `GET /api/auth/me`;
  exposes `{ user, login(), signup(), logout() }`. Renders a lightweight
  loading state while that initial check is pending, to avoid a login-page
  flash for already-authenticated users.
- New `pages/login.tsx` and `pages/signup.tsx` — forms posting to the auth
  endpoints, redirect to `/` on success.
- `<RequireAuth>` wrapper redirects to `/login` when `useAuth()` has no user;
  wraps the existing `Moodboard` page. The internal moodboard/discover/quotes
  navigation inside that page is unchanged.
- Add an account menu (email + "Log out") to the existing header/nav.

## Extension & migration

- Extension is left unauthenticated/unmodified this phase (see Non-goals). It
  will start failing against `/api/items*` once `require-auth` is applied —
  known and accepted, not a regression to silently fix here.
- No data migration needed — fresh repo, no existing rows to backfill.

## Testing

- Backend: unit/integration tests for signup/login/logout/me, and for
  ownership scoping on `items` (user A cannot read/update/delete user B's
  items).
- Frontend: auth context redirect behavior (unauthenticated → `/login`;
  authenticated → app), login/signup form submission and error display.
