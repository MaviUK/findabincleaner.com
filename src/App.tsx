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
  loading,
  children,
}: {
  user: User | null | undefined;
  loading: boolean;
  children: ReactNode;
}) {
  const location = useLocation();
  if (loading) {
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
  children,
}: {
  user: User | null | undefined;
  children: ReactNode;
}) {
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      setUser(session?.user ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
      // keep loading = false after first resolution
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <Router>
      <Layout>
        <Routes>
          {/* Root: WAIT for loading before deciding */}
          <Route
            path="/"
            element={
              loading ? (
                <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">Loading…</div>
              ) : user ? (
                <Navigate to="/dashboard" replace />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Public-only login */}
          <Route
            path="/login"
            element={
              <PublicOnlyRoute user={user}>
                <Login />
              </PublicOnlyRoute>
            }
          />

          {/* Private routes */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute user={user} loading={loading}>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute user={user} loading={loading}>
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
