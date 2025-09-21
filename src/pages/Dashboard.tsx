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
  subscription_status: "active" | "incomplete" | "past_due" | "canceled" | null;
};

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [cleaner, setCleaner] = useState<Cleaner | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          // router guard should normally catch this, but this keeps the page safe on hard reloads
          window.location.href = "/login";
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
          // create a default cleaner record (FREE mode => active)
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
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || !userId || !cleaner) {
    return <div className="p-6">Loading…</div>;
  }

  const needsOnboard = !cleaner.business_name || !cleaner.address || !cleaner.logo_url;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Cleaner Dashboard</h1>

      {needsOnboard ? (
        <CleanerOnboard
          userId={userId}
          cleaner={cleaner}
          onSaved={(patch) =>
            setCleaner((prev) => (prev ? ({ ...prev, ...patch } as Cleaner) : prev))
          }
        />
      ) : (
        <>
          {/* Profile summary + edit link (SPA navigation via <Link/>) */}
          <div className="p-4 border rounded-xl flex items-center gap-4">
            {cleaner.logo_url ? (
              <img
                src={cleaner.logo_url}
                alt="logo"
                className="h-14 w-14 object-contain rounded bg-white"
              />
            ) : (
              <div className="h-14 w-14 bg-gray-200 rounded" />
            )}

            <div className="flex-1">
              <div className="font-semibold">{cleaner.business_name}</div>
              <div className="text-sm text-gray-600">
                {cleaner.address || "No address yet"}
              </div>
            </div>

            <Link to="/settings" className="bg-black text-white px-3 py-2 rounded">
              Edit profile
            </Link>
          </div>

          <h2 className="text-xl font-semibold">Your Service Areas</h2>
          <ServiceAreaEditor cleanerId={cleaner.id} />
        </>
      )}
    </div>
  );
}
