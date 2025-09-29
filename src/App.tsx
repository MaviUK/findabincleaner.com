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
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">Loading…</div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

/** Public-only pages */
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
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">Loading…</div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    // One listener handles everything (INITIAL_SESSION + future changes)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <Router>
      <Layout>
        <Routes>
          {/* Root: wait for auth, then route */}
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

          <Route
            path="/login"
            element={
              <PublicOnlyRoute user={user} authReady={authReady}>
                <Login />
              </PublicOnlyRoute>
            }
          />

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

          <Route path="/landing" element={<Landing />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}
