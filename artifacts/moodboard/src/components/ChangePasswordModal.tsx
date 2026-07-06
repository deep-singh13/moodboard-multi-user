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
