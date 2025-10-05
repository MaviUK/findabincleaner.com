// src/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import CleanerOnboard from "../components/CleanerOnboard";
import ServiceAreaEditor from "../components/ServiceAreaEditor";
import AreasSponsorList from "../components/AreasSponsorList"; // shows “Sponsor #1/#2/#3” for each area
import AnalyticsOverview from "../components/AnalyticsOverview";

type Cleaner = {
  id: string;
  user_id: string;
  business_name: string | null;
  logo_url: string | null;
  address: string | null;
  subscription_status: "active" | "incomplete" | "past_due" | "canceled" | null;
};

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cleaner, setCleaner] = useState<Cleaner | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
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

  if (loading) {
    return <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">Loading…</main>;
  }

  if (err) {
    return (
      <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="card"><div className="card-pad text-red-600">{err}</div></div>
      </main>
    );
  }

  if (!userId || !cleaner) {
    return (
      <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="card"><div className="card-pad">No profile found.</div></div>
      </main>
    );
  }

  const needsOnboard = !cleaner.business_name || !cleaner.address || !cleaner.logo_url;

  return (
    <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8 space-y-8">
      <h1 className="text-2xl font-bold">Cleaner Dashboard</h1>

      {needsOnboard ? (
        <section className="card">
          <div className="card-pad space-y-4">
            <p className="muted">Welcome! Add your logo, business name, and address to complete your profile.</p>
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

              <Link to="/settings" className="btn btn-primary justify-self-end">
                Edit profile
              </Link>
            </div>
          </section>

          {/* Analytics */}
          <section className="card">
            <div className="card-pad space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Analytics</h2>
                <Link to="/analytics" className="text-sm underline">View full stats →</Link>
              </div>
              <AnalyticsOverview />
            </div>
          </section>

          {/* Service areas + Sponsorship actions */}
          <section className="card">
            <div className="card-pad space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Your Service Areas (manage)</h2>
              </div>
              <div className="rounded-xl overflow-hidden border">
                <ServiceAreaEditor cleanerId={cleaner.id} />
              </div>

              <div className="flex items-center justify-between pt-2">
                <h3 className="text-base font-semibold">Sponsor your areas</h3>
                <a href="#/sponsorships" className="text-sm underline">Manage →</a>
              </div>
              <AreasSponsorList cleanerId={cleaner.id} />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
