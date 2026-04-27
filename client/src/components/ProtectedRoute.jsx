import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import AppSkeleton from "./AppSkeleton";

function ProtectedRoute() {
  const location = useLocation();
  const { initialized, status, accessToken } = useSelector((s) => s.auth);

  if (!initialized || status === "loading") {
    return <AppSkeleton compact label="Checking your session…" />;
  }

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Render matched child route directly — Navbar/Footer are in App.jsx
  return <Outlet />;
}

export default ProtectedRoute;