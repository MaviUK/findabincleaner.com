// src/App.tsx
import { useEffect, useState, type ReactNode, useCallback } from "react";
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
import Onboarding from "./pages/Onboarding";
import Analytics from "./pages/Analytics";
import Invoices from "./pages/Invoices";

// ✅ Legal modal
import LegalModal from "./components/LegalModal";
// If your LegalModal exports a type for tabs, you can import it.
// If not, we’ll just use string literals.
// import type { LegalTab } from "./components/LegalModal";

// Bump when you change the legal text to force re-acceptance
const TERMS_VERSION = "2025-09-29";

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

/** TermsGate
 *  Checks the current user's cleaner row for terms acceptance.
 *  If not accepted (or wrong version), redirect to /onboarding.
 */
function TermsGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        setOk(false);
        setChecking(false);
        return;
      }

      const { data: row, error } = await supabase
        .from("cleaners")
        .select("terms_accepted, terms_version")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) {
        console.error("Terms check failed", error);
        setOk(false);
      } else {
        setOk(!!row?.terms_accepted && row?.terms_version === TERMS_VERSION);
      }
      setChecking(false);
    })();
  }, []);

  if (checking) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
        Loading…
      </div>
    );
  }

  if (!ok) return <Navigate to="/onboarding" replace />;

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

type LegalTab = "terms" | "privacy" | "cookies" | "sponsored";

export default function App() {
  // undefined = still checking session, null = no user
  const [user, setUser] = useState<User | null | undefined>(undefined);

  // ✅ Legal modal state (root-mounted)
  const [legalOpen, setLegalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalTab>("terms");

  const openLegal = useCallback((tab: LegalTab) => {
    setLegalTab(tab);
    setLegalOpen(true);
  }, []);

  const closeLegal = useCallback(() => setLegalOpen(false), []);

  // ✅ Allow opening the modal from anywhere via event
  // window.dispatchEvent(new CustomEvent("open-legal", { detail: { tab: "privacy" } }))
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ tab?: LegalTab }>;
      const tab = ce?.detail?.tab;
      openLegal((tab as LegalTab) || "terms");
    };

    window.addEventListener("open-legal", handler as EventListener);
    return () => window.removeEventListener("open-legal", handler as EventListener);
  }, [openLegal]);

  // ✅ Stripe return bridge for HashRouter
  // Stripe strips hashes, so it returns to "/?checkout=success".
  // We convert that into "/#/dashboard?checkout=success&session_id=..."
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");

    if (checkout === "success" || checkout === "cancel") {
      const sessionId = params.get("session_id");

      const next =
        checkout === "success"
          ? `/#/dashboard?checkout=success${
              sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ""
            }`
          : `/#/dashboard?checkout=cancel`;

      window.location.replace(next);
    }
  }, []);

  // 🔧 Normalize path for HashRouter (prevents /settings#/settings)
  // Keep this AFTER Stripe bridge

  useEffect(() => {
    // initial check
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => setUser(session?.user ?? null));

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
          <Route path="/onboarding" element={<Onboarding />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute user={user} loading={loading}>
                <TermsGate>
                  <Dashboard />
                </TermsGate>
              </ProtectedRoute>
            }
          />

          <Route
            path="/settings"
            element={
              <ProtectedRoute user={user} loading={loading}>
                <TermsGate>
                  <Settings />
                </TermsGate>
              </ProtectedRoute>
            }
          />

          <Route
            path="/analytics"
            element={
              <ProtectedRoute user={user} loading={loading}>
                <TermsGate>
                  <Analytics />
                </TermsGate>
              </ProtectedRoute>
            }
          />

          <Route
            path="/invoices"
            element={
              <ProtectedRoute user={user} loading={loading}>
                <TermsGate>
                  <Invoices />
                </TermsGate>
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

        {/* ✅ Mount the LegalModal once at the app root */}
        <LegalModal open={legalOpen} onClose={closeLegal} defaultTab={legalTab} />
      </Layout>
    </Router>
  );
}
