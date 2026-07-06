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
