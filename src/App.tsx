// src/App.tsx
import { useEffect, useState, type ReactNode } from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

import "./index.css";
import Layout from "./components/Layout";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";

/** Guard for private pages */
function ProtectedRoute({
  user,
  authReady,
  children,
}: {
  user: User | null;
  authReady: boolean;
  children: ReactNode;
}) {
  const location = useLocation();

  if (!authReady) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
        Loading…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

/** Public-only pages (e.g., /login). If already logged in, go to dashboard. */
function PublicOnlyRoute({
  user,
  authReady,
  children,
}: {
  user: User | null;
  authReady: boolean;
  children: ReactNode;
}) {
  if (!authReady) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
        Loading…
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  // start as null (logged out) until we know otherwise
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false); // becomes true after INITIAL_SESSION

  useEffect(() => {
    // Single source of truth: onAuthStateChange fires INITIAL_SESSION immediately
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // console.debug("[auth]", event, session?.user?.id); // uncomment to debug
      if (
        event === "INITIAL_SESSION" ||
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED"
      ) {
        setUser(session?.user ?? null);
        setAuthReady(true);
      } else if (event === "SIGNED_OUT" || event === "USER_DELETED") {
        setUser(null);
        setAuthReady(true);
      } else {
        // For other events, ensure we don't hang
        setAuthReady((r) => r || event !== null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Router>
      <Layout>
        <Routes>
          {/* Root: WAIT for authReady before deciding */}
          <Route
            path="/"
            element={
              authReady ? (
                user ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />
              ) : (
                <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">Loading…</div>
              )
            }
          />

          {/* Public-only login */}
          <Route
            path="/login"
            element={
              <PublicOnlyRoute user={user} authReady={authReady}>
                <Login />
              </PublicOnlyRoute>
            }
          />

          {/* Private routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute user={user} authReady={authReady}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute user={user} authReady={authReady}>
                <Settings />
              </ProtectedRoute>
            }
          />

          {/* Optional public page */}
          <Route path="/landing" element={<Landing />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}
