// src/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import CleanerOnboard from "../components/CleanerOnboard";
import ServiceAreaEditor from "../components/ServiceAreaEditor";
// src/pages/Dashboard.tsx (wherever you want the card)
import AnalyticsOverview from "../components/AnalyticsOverview";

export default function Dashboard() {
  return (
    <div className="p-6 space-y-6">
      {/* ...your existing dashboard header/cards... */}
      <AnalyticsOverview />
      {/* maybe link to the full table: */}
      {/* <Link to="/analytics" className="underline text-sm">View full stats →</Link> */}
    </div>
  );
}


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
    return (
      <main className="container mx-auto max-w-6xl px-4 sm:px-6 py-8">
        Loading…
      </main>
    );
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
              onSaved={(patch) => setCleaner((prev) => (prev ? ({ ...prev, ...patch } as Cleaner) : prev))}
            />
          </div>
        </section>
      ) : (
        <>
          {/* Profile summary (fixed alignment) */}
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

              <Link to="/settings" className="btn btn-primary justify-self-end">Edit profile</Link>
            </div>
          </section>

          {/* Service areas (let editor handle its internals; give it a tidy container) */}
          <section className="card">
            <div className="card-pad">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Your Service Areas</h2>
                {/* ServiceAreaEditor renders its own “New Area” UI, so no extra button here */}
              </div>
              <div className="rounded-xl overflow-hidden border">
                {/* If your editor stretches to parent, this wrapper keeps edges crisp */}
                <ServiceAreaEditor cleanerId={cleaner.id} />
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
