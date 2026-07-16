import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import { clearMessages } from "./redux/slices/chatSlice";
import { clearGraphState } from "./redux/slices/graphSlice";
import { clearIngestionState } from "./redux/slices/ingestSlice";
import { clearSession } from "./redux/slices/authSlice";
import { resetWikiState } from "./redux/slices/wikiSlice";
import { logoutRequest } from "./utils/api";

import { useAuthInitialization } from "./hooks/useAuthInitialization";

import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";
import PageSpinner from "./components/PageSpinner";
import ErrorBoundary from "./components/ErrorBoundary";

import "./App.css";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const WikiDashboard = lazy(() => import("./pages/WikiDashboard"));
const DirectoryPage = lazy(() => import("./pages/DirectoryPage"));
const PublicWikiPage = lazy(() => import("./pages/PublicWikiPage"));
const PrivacyPolicy = lazy(() => import("./components/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./components/TermsOfService"));
const ContactPage = lazy(() => import("./components/ContactPage"));

const FOOTER_ROUTES = new Set(["/", "/login", "/register", "/forgot-password", "/privacy", "/terms", "/contact"]);
const WORKSPACE_LINKS = [
  { to: "/wiki", label: "Dashboard" },
  { to: "/directory", label: "Explore Directory", className: "ws-btn ws-btn--primary", style: { marginLeft: '0.5rem', padding: '0.3rem 0.75rem', fontSize: '0.85rem' } },
];

const LANDING_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#pipeline", label: "How it works" },
  { href: "#graph", label: "Graph" },
  { href: "#confidence", label: "Confidence" },
  { to: "/directory", label: "Explore Directory", className: "ws-btn ws-btn--primary" },
];

function AppRouter() {
  const dispatch = useDispatch();
  const location = useLocation();
  const { user } = useSelector((s) => s.auth);
  const [loggingOut, setLoggingOut] = useState(false);

  const isLanding = location.pathname === "/";
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register" || location.pathname === "/forgot-password";
  const showFooter = FOOTER_ROUTES.has(location.pathname);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    
    // Stop in-flight streams immediately on logout
    window.dispatchEvent(new Event("app-logout"));

    try {
      await logoutRequest();
    } catch {
      // clear anyway
    } finally {
      dispatch(clearMessages());
      dispatch(clearGraphState());
      dispatch(clearIngestionState());
      dispatch(resetWikiState());
      dispatch(clearSession());
      setLoggingOut(false);
    }
  };

  const navProps = isLanding
    ? {
        transparent: true,
        links: user ? [{ to: "/wiki", label: "Workspace" }, ...LANDING_LINKS] : LANDING_LINKS,
        user,
        loggingOut,
        onLogout: handleLogout,
        actions: [
          { to: "/login", label: "Sign in", kind: "secondary" },
          { to: "/register", label: "Get started", kind: "primary" },
        ],
      }
    : isAuthPage
      ? {
          actions:
            location.pathname === "/login"
              ? [{ to: "/register", label: "Create account", kind: "secondary" }]
              : [{ to: "/login", label: "Sign in", kind: "secondary" }],
        }
      : {
          links: WORKSPACE_LINKS,
          user,
          loggingOut,
          onLogout: handleLogout,
        };

  return (
    <div className="app-root">
      <Navbar {...navProps} />

      <main className="app-main" id="main-content">
        <ErrorBoundary>
          <Routes>
            <Route
              path="/"
              element={
                <Suspense fallback={null}>
                  <LandingPage />
                </Suspense>
              }
            />

            <Route path="/login" element={<Suspense fallback={<PageSpinner label="Loading..." />}><LoginPage /></Suspense>} />
            <Route path="/register" element={<Suspense fallback={<PageSpinner label="Loading..." />}><RegisterPage /></Suspense>} />
            <Route path="/forgot-password" element={<Suspense fallback={<PageSpinner label="Loading..." />}><ForgotPasswordPage /></Suspense>} />

            <Route path="/privacy" element={<Suspense fallback={<PageSpinner />}><PrivacyPolicy /></Suspense>} />
            <Route path="/terms" element={<Suspense fallback={<PageSpinner />}><TermsOfService /></Suspense>} />
            <Route path="/contact" element={<Suspense fallback={<PageSpinner />}><ContactPage /></Suspense>} />

            <Route element={<ProtectedRoute />}>
              <Route
                path="/wiki"
                element={
                  <Suspense fallback={<PageSpinner label="Loading workspace..." />}>
                    <WikiDashboard />
                  </Suspense>
                }
              />
            </Route>

            <Route path="/directory" element={<Suspense fallback={<PageSpinner />}><DirectoryPage /></Suspense>} />
            <Route path="/share/:slug" element={<Suspense fallback={<PageSpinner />}><PublicWikiPage /></Suspense>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>

      {showFooter && <Footer />}
    </div>
  );
}

import { ThemeProvider } from "./hooks/useTheme";

function App({ onReady }) {
  const { isInitialized } = useAuthInitialization();

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__hideSplash = onReady;
    }
  }, [onReady]);

  useEffect(() => {
    if (isInitialized) {
      onReady?.();
    }
  }, [isInitialized, onReady]);

  if (!isInitialized) return null;

  return (
    <ThemeProvider>
      <AppRouter />
    </ThemeProvider>
  );
}

export default App;
