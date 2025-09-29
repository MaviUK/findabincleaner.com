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

import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Onboarding from "./pages/Onboarding";
import Layout from "./components/Layout";

/** Bump when you change the Terms text */
export const TERMS_VERSION = "2025-09-29";

/* ----------------------- auth + profile hooks ----------------------- */

async function fetchSession(): Promise<User | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user ?? null;
}

async function fetchProfileTerms(userId: string) {
  // Profiles table is optional but recommended. If it doesn't exist, treat as "not accepted".
  const { data, error } = await supabase
    .from("profiles")
    .select("terms_version, terms_accepted_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    // If table missing or RLS blocks, don't throw loops; just say "not accepted yet"
    console.warn("profiles check error:", error.message);
    return { accepted: false };
  }

  return {
    accepted: Boolean(data?.terms_accepted_at && data?.terms_version === TERMS_VERSION),
  };
}

/* ----------------------- Route Guards ----------------------- */

function ProtectedRoute({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [termsOk, setTermsOk] = useState<boolean | undefined>(undefined);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await fetchSession();
        if (cancelled) return;

        if (!u) {
          setUser(null);
          setTermsOk(undefined);
          return;
        }

        setUser(u);

        const t = await fetchProfileTerms(u.id);
        if (cancelled) return;
        setTermsOk(t.accepted);
      } catch (e) {
        if (!cancelled) {
          console.warn(e);
          setUser(null);
          setTermsOk(undefined);
        }
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setUser(sess?.user ?? null);
      // don’t fetch terms here; next render will trigger the effect above
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [location.pathname]);

  // Still checking session
  if (user === undefined) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
        Loading…
      </div>
    );
  }

  // Not logged in → to /login (but remember where they were going)
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // If NOT accepted terms and NOT already on /onboarding → send to /onboarding
  if (termsOk === false && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  // If accepted terms and trying to visit /onboarding, send them onward
  if (termsOk === true && location.pathname === "/onboarding") {
    // After accepting we send users to /settings?firstRun=1 to finish profile
    return <Navigate to="/settings?firstRun=1" replace />;
  }

  // Otherwise allow
  return <>{children}</>;
}

/* ----------------------- App Routes ----------------------- */

export default function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          {/* Public pages */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          {/* Protected pages */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <Onboarding />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}
