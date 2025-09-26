// src/pages/Dashboard.tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import CleanerOnboard from "../components/CleanerOnboard";
import ServiceAreaEditor from "../components/ServiceAreaEditor";

type Cleaner = {
  id: string;
  user_id: string;
  business_name: string | null;
  logo_url: string | null;
  address: string | null;
  // keep subscription for future billing, but default to 'active' in free mode
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
          // ProtectedRoute should normally handle this, but this keeps hard reloads safe.
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
          // Create a starter record in FREE mode (treat as active)
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
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
        Loading…
      </div>
    );
  }

  if (err) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <div className="card">
          <div className="card-pad text-red-600">{err}</div>
        </div>
      </div>
    );
  }

  if (!userId || !cleaner) {
    return (
      <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-12">
        <div className="card">
          <div className="card-pad">No profile found.</div>
        </div>
      </div>
    );
  }

  const needsOnboard = !cleaner.business_name || !cleaner.address || !cleaner.logo_url;

  return (
    <div className="space-y-6">
      <h1 className="section-title text-2xl">Cleaner Dashboard</h1>

      {needsOnboard ? (
        <div className="card">
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
        </div>
      ) : (
        <>
          {/* Profile summary */}
          <div className="card">
            <div className="card-pad flex items-center gap-4">
              {cleaner.logo_url ? (
                <img
                  src={cleaner.logo_url}
                  alt="logo"
                  className="h-16 w-16 object-contain rounded-lg bg-white ring-1 ring-ink-100"
                />
              ) : (
                <div className="h-16 w-16 rounded-lg bg-ink-100" />
              )}

              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{cleaner.business_name}</div>
                <div className="muted truncate">{cleaner.address || "No address yet"}</div>
              </div>

              <Link to="/settings" className="btn btn-primary">
                Edit profile
              </Link>
            </div>
          </div>

          {/* Service areas */}
          <div className="card">
            <div className="card-pad">
              <h2 className="section-title mb-3">Your Service Areas</h2>
              <ServiceAreaEditor cleanerId={cleaner.id} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

