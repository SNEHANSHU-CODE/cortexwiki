import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { clearSession, finishHydration, setSession, setStatus } from "./redux/slices/authSlice";
import AppSkeleton from "./components/AppSkeleton";
import { getSessionFromRefresh } from "./utils/api";
import AppShell from "./layouts/AppShell";
import ProtectedRoute from "./components/ProtectedRoute";
import "./App.css";

const LandingPage  = lazy(() => import("./pages/LandingPage"));
const LoginPage    = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ChatPage     = lazy(() => import("./pages/ChatPage"));
const IngestPage   = lazy(() => import("./pages/IngestPage"));
const GraphPage    = lazy(() => import("./pages/GraphPage"));

function App() {
  const dispatch = useDispatch();
  const { initialized, status } = useSelector((state) => state.auth);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      dispatch(setStatus("loading"));
      try {
        const session = await getSessionFromRefresh();
        if (!active) return;
        dispatch(
          setSession({
            accessToken: session.access_token,
            user:        session.user,
            expiresAt:   session.expires_at ?? null,
          }),
        );
        // setSession already sets initialized = true, but call finishHydration
        // as a safety net in case the shape differs at runtime.
        dispatch(finishHydration());
      } catch {
        if (!active) return;
        dispatch(clearSession());
        // clearSession sets initialized = true; finishHydration is a no-op here
        // but keeps the bootstrap contract explicit.
        dispatch(finishHydration());
      }
    };

    void bootstrap();
    return () => {
      active = false;
    };
  }, [dispatch]);

  // Block render only during the initial token refresh attempt.
  if (!initialized && status === "loading") {
    return <AppSkeleton label="Restoring your workspace..." />;
  }

  return (
    <Suspense fallback={<AppSkeleton label="Loading CortexWiki..." />}>
      <Routes>
        <Route path="/"         element={<LandingPage />} />
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/chat"   element={<ChatPage />} />
          <Route path="/ingest" element={<IngestPage />} />
          <Route path="/graph"  element={<GraphPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default App;