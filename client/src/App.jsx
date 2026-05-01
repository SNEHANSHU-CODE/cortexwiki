import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import { clearMessages }       from "./redux/slices/chatSlice";
import { clearGraphState }     from "./redux/slices/graphSlice";
import { clearIngestFeedback } from "./redux/slices/ingestSlice";
import { clearSession }        from "./redux/slices/authSlice";
import { logoutRequest }       from "./utils/api";

import { useAuthInitialization } from "./hooks/useAuthInitialization";

import Navbar       from "./components/Navbar";
import Footer       from "./components/Footer";
import ProtectedRoute  from "./components/ProtectedRoute";
import PageSpinner     from "./components/PageSpinner";

import "./App.css";

// ── Lazy pages ─────────────────────────────────────────────────────────────
const LandingPage    = lazy(() => import("./pages/LandingPage"));
const LoginPage      = lazy(() => import("./pages/LoginPage"));
const RegisterPage   = lazy(() => import("./pages/RegisterPage"));
const ChatPage       = lazy(() => import("./pages/ChatPage"));
const IngestPage     = lazy(() => import("./pages/IngestPage"));
const GraphPage      = lazy(() => import("./pages/GraphPage"));
const PrivacyPolicy  = lazy(() => import("./components/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./components/TermsOfService"));
const ContactPage    = lazy(() => import("./components/ContactPage"));

// ── Constants ──────────────────────────────────────────────────────────────
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

// ── AppRouter ──────────────────────────────────────────────────────────────
// Matches the finance tracker pattern: router is a separate concern from auth.
function AppRouter() {
  const dispatch   = useDispatch();
  const location   = useLocation();
  const { user, accessToken } = useSelector((s) => s.auth);
  const [loggingOut, setLoggingOut] = useState(false);

  const isLanding  = location.pathname === "/";
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";
  const showFooter = FOOTER_ROUTES.has(location.pathname);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await logoutRequest(); } catch { /* clear anyway */ }
    finally {
      dispatch(clearMessages());
      dispatch(clearGraphState());
      dispatch(clearIngestFeedback());
      dispatch(clearSession());
    }
  };

  // Derive navbar props from route context — one Navbar for entire app
  const navProps = isLanding
    ? {
        transparent: true,
        links: LANDING_LINKS,
        actions: [
          { to: "/login",    label: "Sign in",      kind: "secondary" },
          { to: "/register", label: "Get started →", kind: "primary"   },
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
        <Routes>
          {/* Landing — premium loader while chunk fetches */}
          <Route
            path="/"
            element={
              <Suspense fallback={null}>
                <LandingPage />
              </Suspense>
            }
          />

          {/* Auth pages */}
          <Route path="/login"    element={<Suspense fallback={<PageSpinner label="Loading…" />}><LoginPage /></Suspense>} />
          <Route path="/register" element={<Suspense fallback={<PageSpinner label="Loading…" />}><RegisterPage /></Suspense>} />

          {/* Legal pages */}
          <Route path="/privacy"  element={<Suspense fallback={<PageSpinner />}><PrivacyPolicy /></Suspense>} />
          <Route path="/terms"    element={<Suspense fallback={<PageSpinner />}><TermsOfService /></Suspense>} />
          <Route path="/contact"  element={<Suspense fallback={<PageSpinner />}><ContactPage /></Suspense>} />

          {/* Protected workspace */}
          <Route element={<ProtectedRoute />}>
            <Route path="/chat"   element={<Suspense fallback={<PageSpinner label="Loading chat…" />}><ChatPage /></Suspense>} />
            <Route path="/ingest" element={<Suspense fallback={<PageSpinner label="Loading ingest…" />}><IngestPage /></Suspense>} />
            <Route path="/graph"  element={<Suspense fallback={<PageSpinner label="Loading graph…" />}><GraphPage /></Suspense>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {showFooter && <Footer />}
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────
// Same pattern as finance tracker: auth init runs here, spinner until ready,
// then render the router. onReady hides the HTML splash.
function App({ onReady }) {
  const { isInitialized } = useAuthInitialization();

  // Hide the HTML splash as soon as auth state is resolved
  useEffect(() => {
    if (isInitialized) onReady?.();
  }, [isInitialized, onReady]);

  // While auth is initializing, keep the HTML splash visible —
  // show nothing from React (splash is already in the DOM)
  if (!isInitialized) {
    return null;
  }

  return <AppRouter />;
}

export default App;