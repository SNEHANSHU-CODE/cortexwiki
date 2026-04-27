import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import Navbar from "../components/Navbar";
import { clearSession } from "../redux/slices/authSlice";
import { clearMessages } from "../redux/slices/chatSlice";
import { clearGraphState } from "../redux/slices/graphSlice";
import { clearIngestFeedback } from "../redux/slices/ingestSlice";
import { logoutRequest } from "../utils/api";

function AppShell() {
  const [loggingOut, setLoggingOut] = useState(false);
  const { user } = useSelector((state) => state.auth);
  const dispatch  = useDispatch();
  const navigate  = useNavigate();

  const handleLogout = async () => {
    if (loggingOut) return; // prevent double-click
    setLoggingOut(true);
    try {
      await logoutRequest();
    } catch {
      // Clear local session even if the server call fails.
    } finally {
      dispatch(clearMessages());
      dispatch(clearGraphState());
      dispatch(clearIngestFeedback());
      dispatch(clearSession());
      navigate("/login", { replace: true });
      // No need to reset loggingOut — component unmounts after navigation.
    }
  };

  return (
    <div className="workspace-shell">
      <Navbar
        links={[
          { to: "/chat",   label: "Chat" },
          { to: "/ingest", label: "Ingest" },
          { to: "/graph",  label: "Graph" },
        ]}
        user={user}
        loggingOut={loggingOut}
        onLogout={handleLogout}
      />
      <main className="workspace-main" id="main-content">
        <Outlet />
      </main>
    </div>
  );
}

export default AppShell;