import { describe, it, expect, vi, beforeEach } from "vitest";
import { signup, login, logout, fetchMe, changePassword } from "./auth-api";
import { onUnauthenticated } from "./auth-events";

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

  it("changePassword notifies onUnauthenticated listeners when the session is dead", async () => {
    mockFetchOnce(401, { error: "Not authenticated" });

    const listener = vi.fn();
    onUnauthenticated(listener);

    await expect(changePassword("old-pass", "new-pass")).rejects.toThrow(
      "Not authenticated",
    );

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("changePassword does NOT notify onUnauthenticated listeners on a wrong current password", async () => {
    mockFetchOnce(401, { error: "Current password is incorrect" });

    const listener = vi.fn();
    onUnauthenticated(listener);

    await expect(changePassword("wrong-pass", "new-pass")).rejects.toThrow(
      "Current password is incorrect",
    );

    expect(listener).not.toHaveBeenCalled();
  });
});
