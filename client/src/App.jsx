import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { clearSession, finishHydration, setSession, setStatus } from "./redux/slices/authSlice";
import { clearMessages } from "./redux/slices/chatSlice";
import { clearGraphState } from "./redux/slices/graphSlice";
import { clearIngestFeedback } from "./redux/slices/ingestSlice";
import AppSkeleton from "./components/AppSkeleton";
import ProtectedRoute from "./components/ProtectedRoute";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import { getSessionFromRefresh, logoutRequest } from "./utils/api";
import "./App.css";

// ── Lazy pages ────────────────────────────────────────────────────────────
const LandingPage    = lazy(() => import("./pages/LandingPage"));
const LoginPage      = lazy(() => import("./pages/LoginPage"));
const RegisterPage   = lazy(() => import("./pages/RegisterPage"));
const ChatPage       = lazy(() => import("./pages/ChatPage"));
const IngestPage     = lazy(() => import("./pages/IngestPage"));
const GraphPage      = lazy(() => import("./pages/GraphPage"));
const PrivacyPolicy  = lazy(() => import("./components/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./components/TermsOfService"));
const ContactPage    = lazy(() => import("./components/ContactPage"));

// ── Constants ─────────────────────────────────────────────────────────────
// Footer shown on marketing + legal pages only
const FOOTER_ROUTES = new Set(["/", "/login", "/register", "/privacy", "/terms", "/contact"]);

const WORKSPACE_LINKS = [
  { to: "/chat",   label: "Chat" },
  { to: "/ingest", label: "Ingest" },
  { to: "/graph",  label: "Graph" },
];

const LANDING_LINKS = [
  { href: "#features",   label: "Features" },
  { href: "#pipeline",   label: "How it works" },
  { href: "#graph",      label: "Graph" },
  { href: "#confidence", label: "Confidence" },
];

// ── AppLayout ─────────────────────────────────────────────────────────────
function AppLayout() {
  const dispatch  = useDispatch();
  const location  = useLocation();
  const { user, accessToken } = useSelector((s) => s.auth);
  const [loggingOut, setLoggingOut] = useState(false);

  const isLanding  = location.pathname === "/";
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";
  const showFooter = FOOTER_ROUTES.has(location.pathname);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutRequest();
    } catch {
      // Clear local session even if the server call fails
    } finally {
      dispatch(clearMessages());
      dispatch(clearGraphState());
      dispatch(clearIngestFeedback());
      dispatch(clearSession());
      // ProtectedRoute redirects to /login after clearSession
    }
  };

  // Derive navbar props from current route context
  const navProps = isLanding
    ? {
        transparent: true,
        links: LANDING_LINKS,
        actions: [
          { to: "/login",    label: "Sign in",       kind: "secondary" },
          { to: "/register", label: "Get started →",  kind: "primary" },
        ],
      }
    : isAuthPage
    ? {
        actions: location.pathname === "/login"
          ? [{ to: "/register", label: "Create account", kind: "secondary" }]
          : [{ to: "/login",    label: "Sign in",        kind: "secondary" }],
      }
    : {
        links:     WORKSPACE_LINKS,
        user,
        loggingOut,
        onLogout:  handleLogout,
      };

  return (
    <div className="app-root">
      <Navbar {...navProps} />

      <main className="app-main" id="main-content">
        <Suspense fallback={<AppSkeleton label="Loading CortexWiki…" />}>
          <Routes>
            {/* Public */}
            <Route path="/"         element={<LandingPage />} />
            <Route path="/login"    element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Legal */}
            <Route path="/privacy"  element={<PrivacyPolicy />} />
            <Route path="/terms"    element={<TermsOfService />} />
            <Route path="/contact"  element={<ContactPage />} />

            {/* Protected workspace */}
            <Route element={<ProtectedRoute />}>
              <Route path="/chat"   element={<ChatPage />} />
              <Route path="/ingest" element={<IngestPage />} />
              <Route path="/graph"  element={<GraphPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      {showFooter && <Footer />}
    </div>
  );
}

// ── App (bootstrap) ───────────────────────────────────────────────────────
function App() {
  const dispatch = useDispatch();
  const { initialized, status } = useSelector((s) => s.auth);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      dispatch(setStatus("loading"));
      try {
        const session = await getSessionFromRefresh();
        if (!active) return;
        dispatch(setSession({
          accessToken: session.access_token,
          user:        session.user,
          expiresAt:   session.expires_at ?? null,
        }));
        dispatch(finishHydration());
      } catch {
        if (!active) return;
        dispatch(clearSession());
        dispatch(finishHydration());
      }
    };
    void bootstrap();
    return () => { active = false; };
  }, [dispatch]);

  if (!initialized && status === "loading") {
    return <AppSkeleton label="Restoring your workspace…" />;
  }

  return <AppLayout />;
}

export default App;