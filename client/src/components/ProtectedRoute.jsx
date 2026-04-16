import { Navigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import AppSkeleton from "./AppSkeleton";

function ProtectedRoute({ children }) {
  const location = useLocation();
  const { initialized, status, accessToken } = useSelector((s) => s.auth);

  // Show skeleton while the bootstrap refresh is still in flight.
  if (!initialized || status === "loading") {
    return <AppSkeleton compact label="Checking your session…" />;
  }

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export default ProtectedRoute;