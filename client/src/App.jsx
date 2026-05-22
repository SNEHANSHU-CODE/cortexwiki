import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import { clearMessages } from "./redux/slices/chatSlice";
import { clearGraphState } from "./redux/slices/graphSlice";
import { clearIngestFeedback } from "./redux/slices/ingestSlice";
import { clearSession } from "./redux/slices/authSlice";
import { clearActiveWiki } from "./redux/slices/wikiSlice";
import { logoutRequest } from "./utils/api";

import { useAuthInitialization } from "./hooks/useAuthInitialization";

import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";
import PageSpinner from "./components/PageSpinner";

import "./App.css";

const LandingPage = lazy(() => import("./pages/LandingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const WikiDashboard = lazy(() => import("./pages/WikiDashboard"));
const PrivacyPolicy = lazy(() => import("./components/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./components/TermsOfService"));
const ContactPage = lazy(() => import("./components/ContactPage"));

const FOOTER_ROUTES = new Set(["/", "/login", "/register", "/privacy", "/terms", "/contact"]);
const WORKSPACE_LINKS = [{ to: "/wiki", label: "Wiki" }];

const LANDING_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#pipeline", label: "How it works" },
  { href: "#graph", label: "Graph" },
  { href: "#confidence", label: "Confidence" },
];

function AppRouter() {
  const dispatch = useDispatch();
  const location = useLocation();
  const { user } = useSelector((s) => s.auth);
  const [loggingOut, setLoggingOut] = useState(false);

  const isLanding = location.pathname === "/";
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";
  const showFooter = FOOTER_ROUTES.has(location.pathname);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutRequest();
    } catch {
      // clear anyway
    } finally {
      dispatch(clearMessages());
      dispatch(clearGraphState());
      dispatch(clearIngestFeedback());
      dispatch(clearActiveWiki());
      dispatch(clearSession());
    }
  };

  const navProps = isLanding
    ? {
        transparent: true,
        links: LANDING_LINKS,
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

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {showFooter && <Footer />}
    </div>
  );
}

function App({ onReady }) {
  const { isInitialized } = useAuthInitialization();

  useEffect(() => {
    if (isInitialized) onReady?.();
  }, [isInitialized, onReady]);

  if (!isInitialized) return null;

  return <AppRouter />;
}

export default App;
