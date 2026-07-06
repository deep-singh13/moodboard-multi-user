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
