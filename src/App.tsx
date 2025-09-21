import { useEffect, useState, type ReactNode } from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
} from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";

function Header({ user }: { user: User | null | undefined }) {
  return (
    <header className="px-4 py-3 border-b flex items-center gap-4">
      <Link to="/" className="font-bold">Find a Bin Cleaner</Link>
      <nav className="ml-auto flex items-center gap-3">
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/settings">Profile</Link>
        {!user ? (
          <Link to="/login" className="bg-black text-white px-3 py-1 rounded">Login</Link>
        ) : (
          <button
            className="bg-black text-white px-3 py-1 rounded"
            onClick={async () => {
              await supabase.auth.signOut();
              // With HashRouter we must navigate via hash
              window.location.hash = "#/";
            }}
          >
            Logout
          </button>
        )}
      </nav>
    </header>
  );
}

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
  if (loading) return <div className="p-6">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">404</h1>
      <p className="mt-2">
        That page doesn’t exist. <Link to="/" className="underline">Go home</Link>.
      </p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setUser(session?.user ?? null)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const loading = user === undefined;

  return (
    <Router>
      <Header user={user} />
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

        {/* Optional: quick sanity check */}
        <Route path="/_debug" element={<div className="p-6">Router is working ✅</div>} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}
