// src/App.tsx
import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

// pages you already have (or added earlier)
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings"; // the cleaner settings page we just made
// import Subscribe from "./pages/Subscribe"; // keep for later if you re-enable billing

function Header({ user }: { user: User | null }) {
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
            onClick={() => supabase.auth.signOut().then(() => (window.location.href = "/"))}
          >
            Logout
          </button>
        )}
      </nav>
    </header>
  );
}

function ProtectedRoute({ user, children }: { user: User | null | undefined; children: ReactNode }) {
  const location = useLocation();
  if (user === undefined) return <div className="p-6">Checking session…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function NotFound() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">404</h1>
      <p className="mt-2">That page doesn’t exist. <Link to="/" className="underline">Go home</Link>.</p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    // initial load
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user ?? null));
    // subscribe to changes
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub?.subscription.unsubscribe();
  }, []);

  return (
    <BrowserRouter>
      <Header user={user ?? null} />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute user={user}>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <ProtectedRoute user={user}>
              <Settings />
            </ProtectedRoute>
          }
        />

        {/* <Route path="/subscribe" element={<Subscribe />} /> */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
