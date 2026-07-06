import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { AuthProvider, useAuth } from "./useAuth";
import { notifyUnauthenticated } from "@/lib/auth-events";

vi.mock("@/lib/auth-api", () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
}));

import { fetchMe, login, signup, logout } from "@/lib/auth-api";

function Consumer() {
  const { user, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{user ? `hello ${user.email}` : "logged out"}</div>;
}

function LoginConsumer() {
  const { login: contextLogin } = useAuth();
  return (
    <button onClick={() => contextLogin("test@example.com", "password")}>
      Login
    </button>
  );
}

function SignupConsumer() {
  const { signup: contextSignup } = useAuth();
  return (
    <button onClick={() => contextSignup("newuser@example.com", "password")}>
      Signup
    </button>
  );
}

function LogoutConsumer() {
  const { user, logout: contextLogout } = useAuth();
  return (
    <div>
      <div>{user ? `hello ${user.email}` : "logged out"}</div>
      <button onClick={() => contextLogout()}>Logout</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockReset();
    vi.mocked(login).mockReset();
    vi.mocked(signup).mockReset();
    vi.mocked(logout).mockReset();
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

  it("updates user state when login is called", async () => {
    vi.mocked(fetchMe).mockResolvedValue(null);
    vi.mocked(login).mockResolvedValue({
      id: "u2",
      email: "test@example.com",
    });

    render(
      <AuthProvider>
        <Consumer />
        <LoginConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("logged out")).toBeInTheDocument());

    const loginButton = screen.getByRole("button", { name: /login/i });
    fireEvent.click(loginButton);

    await waitFor(() =>
      expect(screen.getByText("hello test@example.com")).toBeInTheDocument(),
    );
  });

  it("updates user state when signup is called", async () => {
    vi.mocked(fetchMe).mockResolvedValue(null);
    vi.mocked(signup).mockResolvedValue({
      id: "u3",
      email: "newuser@example.com",
    });

    render(
      <AuthProvider>
        <Consumer />
        <SignupConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("logged out")).toBeInTheDocument());

    const signupButton = screen.getByRole("button", { name: /signup/i });
    fireEvent.click(signupButton);

    await waitFor(() =>
      expect(screen.getByText("hello newuser@example.com")).toBeInTheDocument(),
    );
  });

  it("clears user state when logout is called", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: "u4", email: "user@example.com" });
    vi.mocked(logout).mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <LogoutConsumer />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("hello user@example.com")).toBeInTheDocument(),
    );

    const logoutButton = screen.getByRole("button", { name: /logout/i });
    fireEvent.click(logoutButton);

    await waitFor(() => expect(screen.getByText("logged out")).toBeInTheDocument());
  });

  it("clears user state when an unauthenticated event fires after login", async () => {
    vi.mocked(fetchMe).mockResolvedValue({ id: "u5", email: "session@example.com" });

    const { container } = render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    const scoped = within(container);

    await waitFor(() =>
      expect(scoped.getByText("hello session@example.com")).toBeInTheDocument(),
    );

    notifyUnauthenticated();

    await waitFor(() => expect(scoped.getByText("logged out")).toBeInTheDocument());
  });
});
