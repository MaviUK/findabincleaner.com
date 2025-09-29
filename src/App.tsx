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

function LoadingScreen() {
  return (
    <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
      Loading…
    </main>
  );
}

/** Guard for private pages */
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

/** Public-only pages (e.g., /login). If already logged in, go to dashboard. */
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
    let mounted = true;

    // 1) Get current session immediately on mount
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setReady(true);
    })();

    // 2) Subscribe to future changes (login/logout, token refresh)
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
      setReady(true);
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
          {/* Root: decide only after ready */}
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
