import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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

  afterEach(() => {
    cleanup();
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
