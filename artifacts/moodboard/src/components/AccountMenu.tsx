import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export function AccountMenu() {
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

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
      <button className="account-menu-logout" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}
