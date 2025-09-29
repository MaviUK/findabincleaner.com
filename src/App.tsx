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

/* --- Small loading UI while auth bootstraps --- */
function LoadingScreen() {
  return (
    <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
      Loading…
    </main>
  );
}

/* --- Guard for private pages --- */
function ProtectedRoute({
  user,
  ready,
  children,
}: {
  user: User | null;
  ready: boolean;
  children: ReactNode;
}) {
  const location = useLocation();
  if (!ready) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

/* --- Public-only pages (e.g., /login) --- */
function PublicOnlyRoute({
  user,
  ready,
  children,
}: {
  user: User | null;
  ready: boolean;
  children: ReactNode;
}) {
  if (!ready) return <LoadingScreen />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // IMPORTANT: rely on INITIAL_SESSION so OAuth callback can complete
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") {
        setUser(session?.user ?? null);
        setReady(true); // decide routes only after initial session is known
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setUser(session?.user ?? null);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Router>
      <Layout>
        <Routes>
          {/* Root: wait for `ready` before choosing */}
          <Route
            path="/"
            element={
              ready ? (
                user ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />
              ) : (
                <LoadingScreen />
              )
            }
          />

          {/* Public-only login */}
          <Route
            path="/login"
            element={
              <PublicOnlyRoute user={user} ready={ready}>
                <Login />
              </PublicOnlyRoute>
            }
          />

          {/* Private routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute user={user} ready={ready}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute user={user} ready={ready}>
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
