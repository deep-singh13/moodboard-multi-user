import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { AccountMenu } from "./AccountMenu";

const mockLogout = vi.fn();
const mockUseAuth = vi.fn();

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/components/ChangePasswordModal", () => ({
  ChangePasswordModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="change-password-modal">
      <button onClick={onClose}>close-modal</button>
    </div>
  ),
}));

describe("AccountMenu", () => {
  beforeEach(() => {
    mockLogout.mockReset();
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@example.com" },
      logout: mockLogout,
    });
  });

  afterEach(() => {
    cleanup();
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

  it("opens the change password modal when clicked", () => {
    render(<AccountMenu />);

    expect(screen.queryByTestId("change-password-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(screen.getByTestId("change-password-modal")).toBeInTheDocument();
  });
});
