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
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
      <h1 className="section-title text-2xl mb-2">404</h1>
      <p className="muted">That page doesn’t exist.</p>
    </div>
  );
}

export default function App() {
  // undefined = still checking session, null = no user
  const [user, setUser] = useState<User | null | undefined>(undefined);

  // 🔧 Normalize path for HashRouter (prevents /settings#/settings)
  useEffect(() => {
    if (window.location.pathname !== "/") {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  useEffect(() => {
    // initial check
   supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));

    // keep in sync with auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loading = user === undefined;

  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

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

          <Route
            path="/_debug"
            element={
              <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
                Router is working ✅
              </div>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </Router>
  );
}
