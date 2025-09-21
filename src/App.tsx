import { useEffect, useState, type ReactNode } from "react";
import {
  HashRouter as Router,  // <-- hash routing to avoid Netlify rewrites
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
} from "react-router-dom";

// If you want to wire Supabase later, you can.
// For this sanity pass, we keep auth out so it can't block rendering.
// import { supabase } from "./lib/supabase";
// import type { User } from "@supabase/supabase-js";

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";

// Minimal fake “auth” to prove routing works.
// Replace with supabase once you’ve verified /#/settings renders.
type User = { id: string } | null;

function useFakeAuth() {
  const [user, setUser] = useState<User>(null);
  useEffect(() => {
    // Pretend we are logged in. Set to `null` to test the login redirect.
    setUser({ id: "demo" });
  }, []);
  return { user, loading: false };
}

function Header({ user }: { user: User }) {
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
            onClick={() => {
              // Replace with supabase.auth.signOut() later
              window.location.hash = "#/";
              location.reload();
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
  user: User;
  loading: boolean;
  children: ReactNode;
}) {
  const location = useLocation();
  if (loading) return <div className="p-6">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function NotFound() {
  const loc = useLocation();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">404</h1>
      <p className="mt-2">No match for: <code>{loc.pathname}</code>. <Link to="/" className="underline">Go home</Link>.</p>
    </div>
  );
}

export default function App() {
  const { user, loading } = useFakeAuth(); // swap to real supabase later

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
        <Route path="/_debug" element={<div className="p-6">Router is working ✅</div>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}
