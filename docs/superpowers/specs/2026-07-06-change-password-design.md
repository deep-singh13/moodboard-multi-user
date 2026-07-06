# Change Password — Design

## Context

Multi-account support (email + password, Postgres-backed sessions) already
shipped. There is currently no way for a logged-in user to change their
password — this adds that.

## Goals

- A logged-in user can change their own password from within the app.
- Changing the password requires re-entering the current password, to
  prevent someone at an already-authenticated, unattended browser from
  silently locking the real owner out.

## Non-goals

- No email-based "forgot password" / reset-link flow — out of scope, same as
  the original auth spec (would need an email-sending service).
- No revocation of other active sessions on password change — the current
  session stays logged in, and any other sessions for the account are left
  alone. This app is effectively single-browser-per-user today; multi-session
  revocation can be revisited later if that changes.
- No new routes/pages — implemented as a modal off the existing account menu.

## Backend

New route: `POST /api/auth/change-password`, gated by the existing
`requireAuth` middleware (mounted alongside the other `/auth/*` routes).

Request body: `{ currentPassword: string, newPassword: string }`.

Behavior:
1. Validate `newPassword.length >= 8` (same rule as signup) → `400 { error }`
   otherwise.
2. Verify `currentPassword` via the existing `verifyUserPassword(req.user!.email, currentPassword)` from `lib/users.ts` (the session already carries the
   user's email, so no extra lookup is needed) → `401 { error: "Current
   password is incorrect" }` if it fails.
3. On success, call a new `updatePassword(userId: string, newPassword: string): Promise<void>` in `lib/users.ts`, which hashes the new password with
   bcrypt (same `BCRYPT_ROUNDS` constant already used by `createUser`) and
   updates `users.password_hash` for that row.
4. Respond `200 { ok: true }`.

The current session is untouched. No changes to the `sessions` table or to
`requireAuth`.

## Frontend

- `changePassword(currentPassword: string, newPassword: string): Promise<void>`
  added to `lib/auth-api.ts`, following the same `credentials: "include"` +
  throw-the-server's-error-message pattern already used by `signup`/`login`.
- New `components/ChangePasswordModal.tsx`: a form with "Current password"
  and "New password" fields, reusing the existing `.modal-input`/`.modal-error`
  CSS classes (same visual pattern as `AddItemModal`). Client-side validates
  the new password is `>= 8` characters before calling the API (mirroring
  `signup.tsx`'s existing check). On success, the modal closes immediately
  (no lingering success toast — matches the signup/login pattern of
  succeed-then-move-on). On failure (wrong current password, or a validation
  error), shows the message inline and stays open.
- `components/AccountMenu.tsx` gets a small "Change password" text link next
  to "Log out", which opens `ChangePasswordModal`. No new routes; `useAuth()`'s
  shape is unchanged — the modal talks directly to `auth-api.ts`.

## Error handling

Two failure modes only, both shown inline in the modal without closing it:
- Current password incorrect (`401`).
- New password too short (`400`, though this is also caught client-side
  before the request is even sent).

No other network-error handling beyond what `auth-api.ts`'s existing
`parseJsonOrThrow` already provides.

## Testing

- Backend (`artifacts/api-server/src/routes/auth.test.ts` or a new file
  alongside it): correct current password → success, and the new password
  works on a subsequent login while the old one no longer does; wrong current
  password → `401`; short new password → `400`. Mirrors the existing
  `auth.test.ts` structure and test-email-domain cleanup pattern.
- Frontend: a `changePassword` case added to `auth-api.test.ts` (same shape as
  the existing `login`/`signup` cases), and a `ChangePasswordModal.test.tsx`
  covering the client-side length validation and the wrong-current-password
  error display, mirroring `signup.test.tsx`.
