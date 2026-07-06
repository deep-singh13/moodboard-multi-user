# Change Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a logged-in user change their own password from a modal in the account menu.

**Architecture:** A new `POST /api/auth/change-password` route (gated by the existing `requireAuth`) verifies the current password via the existing `verifyUserPassword`, then hashes and persists the new one. The frontend adds a `changePassword()` call to the existing `auth-api.ts`, and a `ChangePasswordModal` opened from a new "Change password" link in `AccountMenu`, following the same modal/error patterns already used elsewhere in this app.

**Tech Stack:** Same as the rest of this feature — Express, bcrypt, vitest/supertest (backend); React, vitest/@testing-library/react (frontend).

**Spec:** `docs/superpowers/specs/2026-07-06-change-password-design.md`

## Global Constraints

- Changing the password requires re-entering and verifying the current password.
- Other active sessions for the account are **not** revoked; only the current session is affected (and it stays logged in).
- No new routes/pages — this is a modal off the existing account menu.
- No email verification/reset-link flow — out of scope.

---

## Task 1: `updatePassword` in the users data-access module

**Files:**
- Modify: `artifacts/api-server/src/lib/users.ts`
- Modify: `artifacts/api-server/src/lib/users.test.ts`

**Interfaces:**
- Consumes: `pool` from `./db`, `BCRYPT_ROUNDS` (existing constant in this file).
- Produces: `updatePassword(userId: string, newPassword: string): Promise<void>`. Used by Task 2's change-password route.

- [ ] **Step 1: Write the failing test**

Add to `artifacts/api-server/src/lib/users.test.ts` (append a new `describe` block after the existing ones, inside the same file — it already has `beforeAll`/`afterAll` covering `initDb()`/cleanup/`pool.end()`):

```ts
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
```

Update the import at the top of the file to include `updatePassword`:

```ts
import { createUser, verifyUserPassword, updatePassword } from "./users";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- src/lib/users.test.ts`
Expected: FAIL — `updatePassword` is not exported from `./users`.

- [ ] **Step 3: Implement**

Add to `artifacts/api-server/src/lib/users.ts`, after the existing `verifyUserPassword` function:

```ts
export async function updatePassword(userId: string, newPassword: string): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
    passwordHash,
    userId,
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- src/lib/users.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/users.ts artifacts/api-server/src/lib/users.test.ts
git commit -m "feat(api-server): add updatePassword to users data-access module"
```

---

## Task 2: `POST /api/auth/change-password` route

**Files:**
- Modify: `artifacts/api-server/src/routes/auth.ts`
- Modify: `artifacts/api-server/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: `verifyUserPassword`, `updatePassword` (Task 1) from `../lib/users`; `requireAuth` from `../middlewares/require-auth`; `isValidPassword`, `MIN_PASSWORD_LENGTH` (already defined at the top of `auth.ts`).
- Produces: `POST /api/auth/change-password` — body `{ currentPassword: string, newPassword: string }`, requires authentication. `200 { ok: true }` on success; `401 { error: "Current password is incorrect" }` if `currentPassword` is wrong or missing; `400 { error }` if `newPassword` is under 8 characters.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/api-server/src/routes/auth.test.ts` (after the existing `POST /api/auth/logout` describe block, same file — it already has the shared `TEST_EMAIL_DOMAIN`/`cleanup`/`beforeAll`/`afterAll`):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- src/routes/auth.test.ts`
Expected: FAIL — `/api/auth/change-password` doesn't exist yet (404s).

- [ ] **Step 3: Implement the route**

Edit `artifacts/api-server/src/routes/auth.ts`. Update the import at the top:

```ts
import { createUser, verifyUserPassword, updatePassword } from "../lib/users";
```

Add this route after the existing `router.post("/auth/logout", ...)` handler and before `router.get("/auth/me", ...)`:

```ts
router.post("/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };

  if (!isValidPassword(newPassword)) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const verified = await verifyUserPassword(req.user!.email, currentPassword);
  if (!verified) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  await updatePassword(req.user!.id, newPassword);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- src/routes/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full backend test suite and typecheck**

Run: `pnpm --filter @workspace/api-server test`
Expected: All tests pass, no regressions.

Run: `pnpm --filter @workspace/api-server typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/auth.ts artifacts/api-server/src/routes/auth.test.ts
git commit -m "feat(api-server): add change-password route"
```

---

## Task 3: Frontend `changePassword` API client

**Files:**
- Modify: `artifacts/moodboard/src/lib/auth-api.ts`
- Modify: `artifacts/moodboard/src/lib/auth-api.test.ts`

**Interfaces:**
- Consumes: `parseJsonOrThrow`, `BASE` (existing helpers in this file).
- Produces: `changePassword(currentPassword: string, newPassword: string): Promise<void>`. Used by Task 4's `ChangePasswordModal`.

- [ ] **Step 1: Write the failing tests**

Add to `artifacts/moodboard/src/lib/auth-api.test.ts`. Update the import at the top:

```ts
import { signup, login, logout, fetchMe, changePassword } from "./auth-api";
```

Add these two test cases inside the existing `describe("auth-api", ...)` block, after the `logout` test:

```ts
  it("changePassword resolves on success", async () => {
    mockFetchOnce(200, { ok: true });
    await expect(changePassword("old-pass", "new-pass")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/change-password",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("changePassword throws the server error message on failure", async () => {
    mockFetchOnce(401, { error: "Current password is incorrect" });
    await expect(changePassword("wrong-pass", "new-pass")).rejects.toThrow(
      "Current password is incorrect",
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/moodboard test -- src/lib/auth-api.test.ts`
Expected: FAIL — `changePassword` is not exported from `./auth-api`.

- [ ] **Step 3: Implement**

Add to `artifacts/moodboard/src/lib/auth-api.ts`, after the existing `logout` function:

```ts
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${BASE}/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await parseJsonOrThrow(res);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/moodboard test -- src/lib/auth-api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/moodboard/src/lib/auth-api.ts artifacts/moodboard/src/lib/auth-api.test.ts
git commit -m "feat(moodboard): add changePassword to auth API client"
```

---

## Task 4: `ChangePasswordModal` component

**Files:**
- Create: `artifacts/moodboard/src/components/ChangePasswordModal.tsx`
- Test: `artifacts/moodboard/src/components/ChangePasswordModal.test.tsx`

**Interfaces:**
- Consumes: `changePassword` (Task 3) from `@/lib/auth-api`.
- Produces: `<ChangePasswordModal onClose={() => void} />`. Used by Task 5's `AccountMenu`.

- [ ] **Step 1: Write the failing tests**

Create `artifacts/moodboard/src/components/ChangePasswordModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChangePasswordModal } from "./ChangePasswordModal";

const mockChangePassword = vi.fn();

vi.mock("@/lib/auth-api", () => ({
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
}));

describe("ChangePasswordModal", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    mockChangePassword.mockReset();
    onClose.mockReset();
  });

  it("rejects a short new password before calling the API", async () => {
    render(<ChangePasswordModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "oldpassword123" },
    });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(mockChangePassword).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the server error when the current password is wrong, and does not close", async () => {
    mockChangePassword.mockRejectedValue(new Error("Current password is incorrect"));
    render(<ChangePasswordModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "wrongpassword" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() =>
      expect(screen.getByText("Current password is incorrect")).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls the API and closes on success", async () => {
    mockChangePassword.mockResolvedValue(undefined);
    render(<ChangePasswordModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "oldpassword123" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    await waitFor(() =>
      expect(mockChangePassword).toHaveBeenCalledWith("oldpassword123", "newpassword123"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/moodboard test -- src/components/ChangePasswordModal.test.tsx`
Expected: FAIL — `./ChangePasswordModal` module does not exist.

- [ ] **Step 3: Implement**

Create `artifacts/moodboard/src/components/ChangePasswordModal.tsx`:

```tsx
import { useState, useRef, type FormEvent } from "react";
import { changePassword } from "@/lib/auth-api";

const MIN_PASSWORD_LENGTH = 8;

interface ChangePasswordModalProps {
  onClose: () => void;
}

export function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="modal-drawer">
        <div className="modal-handle" />
        <p className="modal-label">Change password</p>

        <form onSubmit={handleSubmit}>
          {error && <p className="modal-error">{error}</p>}
          <label className="auth-label" htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            className="modal-input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
          <label className="auth-label" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            className="modal-input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <div className="modal-actions">
            <button type="button" className="modal-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="modal-btn-primary" disabled={submitting}>
              {submitting ? "Saving…" : "Change password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/moodboard test -- src/components/ChangePasswordModal.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add artifacts/moodboard/src/components/ChangePasswordModal.tsx \
  artifacts/moodboard/src/components/ChangePasswordModal.test.tsx
git commit -m "feat(moodboard): add ChangePasswordModal"
```

---

## Task 5: Wire "Change password" into the account menu

**Files:**
- Modify: `artifacts/moodboard/src/components/AccountMenu.tsx`
- Modify: `artifacts/moodboard/src/components/AccountMenu.test.tsx`
- Modify: `artifacts/moodboard/src/index.css`

**Interfaces:**
- Consumes: `ChangePasswordModal` (Task 4) from `@/components/ChangePasswordModal`.
- Produces: `AccountMenu` renders a "Change password" link that opens `ChangePasswordModal`.

- [ ] **Step 1: Write the failing test**

Edit `artifacts/moodboard/src/components/AccountMenu.test.tsx`. Add this mock near the top, after the existing `vi.mock("@/hooks/useAuth", ...)` block:

```ts
vi.mock("@/components/ChangePasswordModal", () => ({
  ChangePasswordModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="change-password-modal">
      <button onClick={onClose}>close-modal</button>
    </div>
  ),
}));
```

Add this test case inside the existing `describe("AccountMenu", ...)` block, after the "shows the user's email and calls logout on click" test:

```ts
  it("opens the change password modal when clicked", () => {
    render(<AccountMenu />);

    expect(screen.queryByTestId("change-password-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(screen.getByTestId("change-password-modal")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/moodboard test -- src/components/AccountMenu.test.tsx`
Expected: FAIL — no "Change password" button exists yet.

- [ ] **Step 3: Implement**

Replace the full contents of `artifacts/moodboard/src/components/AccountMenu.tsx`:

```tsx
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";

export function AccountMenu() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

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
      <button
        className="account-menu-change-password"
        onClick={() => setShowChangePassword(true)}
      >
        Change password
      </button>
      <button className="account-menu-logout" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS for the new link**

Append to the end of `artifacts/moodboard/src/index.css`:

```css
.account-menu-change-password {
  background: none;
  border: none;
  padding: 0;
  color: var(--text-secondary);
  font-family: 'DM Sans', sans-serif;
  font-size: var(--text-sm);
  text-decoration: underline;
  cursor: pointer;
}

.account-menu-change-password:hover {
  color: var(--text-primary);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @workspace/moodboard test -- src/components/AccountMenu.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full frontend test suite and typecheck**

Run: `pnpm --filter @workspace/moodboard test`
Expected: All tests pass, no regressions.

Run: `pnpm --filter @workspace/moodboard typecheck`
Expected: PASS, no errors.

- [ ] **Step 7: Commit**

```bash
git add artifacts/moodboard/src/components/AccountMenu.tsx \
  artifacts/moodboard/src/components/AccountMenu.test.tsx artifacts/moodboard/src/index.css
git commit -m "feat(moodboard): wire change password into the account menu"
```

---

## Spec Coverage Check

- Current-password re-verification → Task 2.
- No other-session revocation → Task 2 (only the acting request's session is touched; no session-table queries added).
- Modal off the account menu, no new routes → Tasks 4–5.
- Backend and frontend testing per spec → Tasks 1–4 (unit/integration coverage for both layers).
