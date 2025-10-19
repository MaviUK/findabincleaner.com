// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import CleanerOnboard from "../components/CleanerOnboard";
import ServiceAreaEditor from "../components/ServiceAreaEditor";
import AnalyticsOverview from "../components/AnalyticsOverview";

type Cleaner = {
  id: string;
  user_id: string;
  business_name: string | null;
  logo_url: string | null;
  address: string | null;
  subscription_status: "active" | "incomplete" | "past_due" | "canceled" | null;
};

function useHashQuery() {
  const { hash } = useLocation();
  return useMemo(() => {
    const qIndex = hash.indexOf("?");
    const search = qIndex >= 0 ? hash.slice(qIndex) : "";
    return new URLSearchParams(search);
  }, [hash]);
}

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cleaner, setCleaner] = useState<Cleaner | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Banner + refresh signal after Stripe redirect
  const qs = useHashQuery();
  const navigate = useNavigate();
  const [banner, setBanner] = useState<null | { kind: "success" | "error"; msg: string }>(null);
  const [sponsorshipVersion, setSponsorshipVersion] = useState(0);
  const [openingPortal, setOpeningPortal] = useState(false);

  // Handle ?checkout=success/cancel (and optional checkout_session)
  useEffect(() => {
    const status = qs.get("checkout");
    const checkoutSession = qs.get("checkout_session");

    async function postVerify() {
      if (!checkoutSession) return;
      try {
        await fetch("/.netlify/functions/stripe-postverify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ checkout_session: checkoutSession }),
        });
      } catch {
        // Non-fatal; webhook may still complete
      }
    }

    if (status === "success") {
      postVerify().finally(() => {
        setBanner({ kind: "success", msg: "Payment completed. Your sponsorship will appear shortly." });
        setSponsorshipVersion((v) => v + 1);
        const clean = window.location.hash.replace(/\?[^#]*/g, "");
        setTimeout(() => navigate(clean, { replace: true }), 0);
      });
    } else if (status === "cancel") {
      setBanner({ kind: "error", msg: "Checkout cancelled." });
      const clean = window.location.hash.replace(/\?[^#]*/g, "");
      setTimeout(() => navigate(clean, { replace: true }), 0);
    }
  }, [qs, navigate]);

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        if (!user) {
          window.location.hash = "#/login";
          return;
        }
        setUserId(user.id);

        const { data: existing, error } = await supabase
          .from("cleaners")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();
        if (error) throw error;

        if (!existing) {
          const { data: created, error: insertErr } = await supabase
            .from("cleaners")
            .insert({
              user_id: user.id,
              business_name: user.email?.split("@")[0] || "My Bin Cleaning",
              subscription_status: "active",
            })
            .select("*")
            .single();
          if (insertErr) throw insertErr;
          setCleaner(created as Cleaner);
        } else {
          setCleaner(existing as Cleaner);
        }
      } catch (e: any) {
        setErr(e.message || "Failed to load dashboard.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function openBillingPortal() {
    if (!cleaner) return;
    try {
      setOpeningPortal(true);
      const res = await fetch("/.netlify/functions/billing-portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cleanerId: cleaner.id }),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        setBanner({ kind: "error", msg: data?.error || "Could not open billing portal." });
      }
    } catch (e: any) {
      setBanner({ kind: "error", msg: e?.message || "Could not open billing portal." });
    } finally {
      setOpeningPortal(false);
    }
  }

  if (loading) {
    return (
      <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
        Loading…
      </main>
    );
  }

  if (err) {
    return (
      <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="card">
          <div className="card-pad text-red-600">{err}</div>
        </div>
      </main>
    );
  }

  if (!userId || !cleaner) {
    return (
      <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="card">
          <div className="card-pad">No profile found.</div>
        </div>
      </main>
    );
  }

  const needsOnboard = !cleaner.business_name || !cleaner.address || !cleaner.logo_url;

  return (
    <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Cleaner Dashboard</h1>

      {banner && (
        <section
          className={`rounded-lg border ${
            banner.kind === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          <div className="px-4 py-3 flex items-start justify-between gap-4">
            <div className="text-sm">{banner.msg}</div>
            <button
              className="text-xs opacity-70 hover:opacity-100"
              onClick={() => setBanner(null)}
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      {needsOnboard ? (
        <section className="card">
          <div className="card-pad space-y-4">
            <p className="muted">
              Welcome! Add your logo, business name, and address to complete your profile.
            </p>
            <CleanerOnboard
              userId={userId}
              cleaner={cleaner}
              onSaved={(patch) =>
                setCleaner((prev) => (prev ? ({ ...prev, ...patch } as Cleaner) : prev))
              }
            />
          </div>
        </section>
      ) : (
        <>
          {/* Profile summary */}
          <section className="card">
            <div className="card-pad grid grid-cols-[auto_1fr_auto] items-center gap-4">
              {cleaner.logo_url ? (
                <img
                  src={cleaner.logo_url}
                  alt="logo"
                  className="h-16 w-16 object-contain rounded-lg bg-white ring-1 ring-ink-100"
                />
              ) : (
                <div className="h-16 w-16 rounded-lg bg-ink-100" />
              )}

              <div className="min-w-0">
                <div className="font-semibold truncate">{cleaner.business_name}</div>
                <div className="muted truncate">{cleaner.address || "No address yet"}</div>
              </div>

              <div className="flex gap-2">
                <Link to="/settings" className="btn btn-primary">
                  Edit profile
                </Link>
                <button className="btn" onClick={openBillingPortal} disabled={openingPortal}>
                  {openingPortal ? "Opening…" : "Manage billing"}
                </button>
              </div>
            </div>
          </section>

          {/* Analytics */}
          <section className="card">
            <div className="card-pad space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Analytics</h2>
                <Link to="/analytics" className="text-sm underline">
                  View full stats →
                </Link>
              </div>
              <AnalyticsOverview />
            </div>
          </section>

          {/* Service areas (with Sponsor/Manage inside the list) */}
          <section className="card">
            <div className="card-pad space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Your Service Areas (manage)</h2>
              </div>

              <div className="rounded-xl overflow-hidden border">
                <ServiceAreaEditor
                  cleanerId={cleaner.id}
                  sponsorshipVersion={sponsorshipVersion}
                />
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
