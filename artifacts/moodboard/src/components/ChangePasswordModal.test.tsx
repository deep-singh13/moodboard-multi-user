import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
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

  afterEach(() => {
    cleanup();
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
