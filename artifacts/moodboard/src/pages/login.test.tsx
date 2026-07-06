import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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

  afterEach(() => {
    cleanup();
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
